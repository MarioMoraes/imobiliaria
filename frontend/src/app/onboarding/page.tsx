"use client";

import { useEffect, useRef, useState } from "react";
import { useOrganization, useOrganizationList, useSession } from "@clerk/nextjs";
import { submitOnboarding } from "./actions";

/**
 * Onboarding (MOD-AUTH-04/05). O usuário já fez sign-up no Clerk; aqui informa
 * os dados da imobiliária. O backend cria (ou adota) a Organização = tenant e
 * devolve o `clerkOrgId`; ativamos a org na sessão (`setActive`) para que o
 * próximo token carregue o claim `tenant_id`, e seguimos ao painel.
 */
const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: ".35rem" };

/**
 * A org já aponta para um tenant nosso? É o `tenant_id` no `publicMetadata` que
 * vira o claim do JWT — sem ele o token não abre nada em /v1.
 *
 * Ter organização NÃO é sinal suficiente de já estar onboardado: com "force
 * organization selection" ligado, o Clerk cria uma org sozinho logo após o
 * sign-up (a tela que pede só o nome), e essa org nasce com metadata vazio.
 * Redirecionar por "tem org" mandava justamente o fundador para um painel que
 * não conseguia falar com o backend.
 */
function isProvisioned(publicMetadata: unknown): boolean {
  return Boolean(
    publicMetadata &&
      typeof publicMetadata === "object" &&
      typeof (publicMetadata as { tenant_id?: unknown }).tenant_id === "string",
  );
}

/** Janela em que uma volta ao onboarding conta como "o painel me devolveu". */
const BOUNCE_KEY = "onboarding:bounce";
const BOUNCE_TTL_MS = 60_000;

/**
 * Registra e consome, em UMA tentativa, a ida ao painel. Só vale por um minuto:
 * passado isso, uma visita a /onboarding é do usuário, não um vaivém.
 */
function consumeBounce(): boolean {
  const at = Number(sessionStorage.getItem(BOUNCE_KEY) ?? 0);
  const recent = at > 0 && Date.now() - at < BOUNCE_TTL_MS;
  if (recent) {
    sessionStorage.removeItem(BOUNCE_KEY);
    return true;
  }
  sessionStorage.setItem(BOUNCE_KEY, String(Date.now()));
  return false;
}

/**
 * Vai ao painel com uma navegação de página INTEIRA, não pelo router do Next.
 *
 * Aqui a sessão acabou de mudar (org ativada, token renovado), e o que o painel
 * lê no servidor é o cookie `__session`. Uma navegação client-side pode partir
 * antes de o cookie novo estar escrito — e como o layout do painel devolve para
 * /onboarding quando o backend não reconhece a sessão, o retorno cai NA MESMA
 * rota: o React não remonta o componente, nenhum efeito roda de novo e a tela
 * fica parada em "Criando…" para sempre. Recarregar corta esse nó: o navegador
 * manda o cookie do momento e o servidor renderiza do zero.
 */
function goToDashboard(): void {
  window.location.assign("/dashboard");
}

/**
 * Espera a promessa, mas desiste depois de `ms`. Nenhum passo do pós-cadastro
 * justifica prender o usuário num botão "Criando…" que nunca volta: o tenant já
 * está gravado quando chegamos aqui, então seguir em frente é sempre melhor do
 * que esperar para sempre por uma chamada do SDK que não resolveu.
 */
function withTimeout<T>(promise: Promise<T> | undefined, ms: number): Promise<T | null> {
  if (!promise) return Promise.resolve(null);
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export default function OnboardingPage() {
  const { isLoaded, setActive } = useOrganizationList();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const { session } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quem já pertence a uma imobiliária PROVISIONADA não passa por aqui: é o caso
  // do membro convidado, e submeter este formulário criaria um SEGUNDO tenant no
  // lugar de entrar no da equipe que o convidou. Org sem `tenant_id` não conta —
  // é a org vazia do Clerk, e é exatamente para ela que este formulário existe.
  const adopted = orgLoaded && organization !== null && !isProvisioned(organization.publicMetadata);
  const [stuck, setStuck] = useState(false);
  // `consumeBounce` tem efeito colateral (gasta a tentativa registrada), então
  // não pode rodar duas vezes por montagem — e o efeito reexecuta a cada troca
  // de identidade do `session`. Sem esta trava, a segunda passada consumiria a
  // marca que a primeira acabou de gravar e declararia "travado" um membro
  // convidado que estava apenas sendo encaminhado ao painel.
  const redirectHandled = useRef(false);

  useEffect(() => {
    if (!orgLoaded || !organization) return;
    if (!isProvisioned(organization.publicMetadata)) return;
    if (redirectHandled.current) return;
    redirectHandled.current = true;

    // O painel devolve para cá quando o backend não reconhece a imobiliária da
    // sessão. Se a org TEM `tenant_id`, a causa é token velho em cache — então
    // renovamos antes de voltar, senão os dois lados ficariam se empurrando.
    if (consumeBounce()) {
      // Já renovamos uma vez e o painel devolveu de novo: o problema não é
      // cache. Parar aqui é o que impede um vaivém infinito no navegador.
      setStuck(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      await session?.getToken({ skipCache: true }).catch(() => null);
      if (!cancelled) goToDashboard();
    })();
    return () => {
      cancelled = true;
    };
  }, [orgLoaded, organization, session]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    // A gravação do metadata faz o Clerk atualizar a org no cliente, o que
    // acorda o efeito de redirecionamento acima. Duas navegações concorrentes
    // para o mesmo destino travavam a tela; quem conduz daqui em diante é este
    // handler, que tem o resultado do backend em mãos.
    redirectHandled.current = true;

    const fd = new FormData(e.currentTarget);
    const result = await submitOnboarding({
      name: String(fd.get("name") ?? ""),
      cnpj: String(fd.get("cnpj") ?? "").replace(/\D/g, ""),
      creci: String(fd.get("creci") ?? ""),
      slug: String(fd.get("slug") ?? "").toLowerCase(),
      planId: String(fd.get("planId") ?? "free"),
    });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }

    // Ativa a organização na sessão (fluxo Clerk). Nunca deixa o usuário preso:
    // se o `setActive` não resolver (org já ativa, tarefa de sessão pendente no
    // Clerk), seguimos assim mesmo — o passo que realmente importa é o token
    // novo logo abaixo, e a org correta já está no banco e no metadata.
    if (result.clerkOrgId && isLoaded && setActive) {
      await withTimeout(setActive({ organization: result.clerkOrgId }), 5000);
    }
    // Força um token NOVO antes de navegar. O `tenant_id` acabou de ser gravado
    // no metadata da org, e o Clerk guarda o token de sessão em cache por ~1min:
    // sem `skipCache`, o cookie que o servidor lê no /dashboard ainda seria o
    // anterior — sem o claim — e o painel abriria sem conseguir falar com o
    // backend. É especialmente crítico na org ADOTADA, em que o `setActive`
    // acima não muda a org ativa e pode não disparar refresh nenhum.
    await withTimeout(session?.getToken({ skipCache: true }).catch(() => null), 5000);

    goToDashboard();
  }

  // Só montamos o formulário com a organização já carregada: os valores iniciais
  // vêm dela (campo não controlado lê `defaultValue` uma vez só), e quem vai ser
  // redirecionado não chega a ver um formulário que não lhe diz respeito.
  if (!orgLoaded) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem" }}>
        <p className="subtle text-sm">Carregando…</p>
      </main>
    );
  }

  // A imobiliária existe no Clerk, mas o backend não a reconhece nem com token
  // novo. Dizer isso é melhor do que ficar redirecionando: a causa é de
  // configuração (claim `tenant_id` na sessão do Clerk), não algo que o usuário
  // resolva preenchendo o formulário de novo.
  if (stuck) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem" }}>
        <div className="card" style={{ width: "min(520px, 100%)", padding: "2rem" }}>
          <h1
            style={{ fontFamily: "var(--font-poppins)", fontSize: "1.5rem", marginBottom: ".5rem" }}
          >
            Não foi possível abrir o painel
          </h1>
          <p className="subtle text-sm">
            Sua conta está vinculada a <strong>{organization?.name}</strong>, mas o servidor não
            reconheceu esse vínculo. Saia e entre novamente; se persistir, avise o suporte.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem" }}>
      <div className="card" style={{ width: "min(520px, 100%)", padding: "2rem" }}>
        <h1 style={{ fontFamily: "var(--font-poppins)", fontSize: "1.5rem", marginBottom: ".25rem" }}>
          Configure sua imobiliária
        </h1>
        <p className="subtle text-sm" style={{ marginBottom: "1.5rem" }}>
          {adopted
            ? "Falta o cadastro da imobiliária para liberar o sistema."
            : "Só faltam alguns dados para criar seu espaço."}
        </p>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <label style={fieldStyle}>
            <span className="text-sm">Nome da imobiliária</span>
            <input
              name="name"
              required
              minLength={2}
              className="input"
              placeholder="Imobiliária Move"
              // Na org adotada, o nome que o Clerk já pediu vira o valor inicial —
              // o usuário não precisa digitá-lo duas vezes.
              defaultValue={adopted && organization ? organization.name : undefined}
            />
          </label>

          <label style={fieldStyle}>
            <span className="text-sm">CNPJ</span>
            <input name="cnpj" required className="input" placeholder="00.000.000/0000-00" inputMode="numeric" />
          </label>

          <label style={fieldStyle}>
            <span className="text-sm">Subdomínio (slug)</span>
            <input
              name="slug"
              required
              pattern="[a-z0-9][a-z0-9-]{2,59}"
              className="input"
              placeholder="move"
              title="Minúsculas, números e hífen (3–60)"
            />
          </label>

          <label style={fieldStyle}>
            <span className="text-sm">CRECI (opcional)</span>
            <input name="creci" className="input" placeholder="CRECI-SP 00000-J" />
          </label>

          <input type="hidden" name="planId" value="free" />

          {error && (
            <p className="text-sm" style={{ color: "var(--danger, #e5484d)" }}>
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary" disabled={pending} style={{ marginTop: ".5rem" }}>
            {pending ? "Criando…" : "Criar Imobiliária"}
          </button>
        </form>
      </div>
    </main>
  );
}
