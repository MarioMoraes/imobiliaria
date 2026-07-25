"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useOrganization, useOrganizationList } from "@clerk/nextjs";
import { submitOnboarding } from "./actions";

/**
 * Onboarding (MOD-AUTH-04/05). O usuário já fez sign-up no Clerk; aqui informa
 * os dados da imobiliária. O backend cria a Organização (= tenant) e devolve o
 * `clerkOrgId`; ativamos a org na sessão (`setActive`) para que o próximo token
 * carregue o claim `tenant_id`, e seguimos ao painel.
 */
const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: ".35rem" };

export default function OnboardingPage() {
  const router = useRouter();
  const { isLoaded, setActive } = useOrganizationList();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quem já pertence a uma imobiliária não passa por aqui: é o caso do membro
  // convidado, e submeter este formulário criaria um SEGUNDO tenant no lugar de
  // entrar no da equipe que o convidou.
  useEffect(() => {
    if (orgLoaded && organization) router.replace("/dashboard");
  }, [orgLoaded, organization, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

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

    // Ativa a organização recém-criada na sessão (fluxo Clerk).
    if (result.clerkOrgId && isLoaded && setActive) {
      await setActive({ organization: result.clerkOrgId });
    }
    router.push("/dashboard");
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "2rem" }}>
      <div className="card" style={{ width: "min(520px, 100%)", padding: "2rem" }}>
        <h1 style={{ fontFamily: "var(--font-poppins)", fontSize: "1.5rem", marginBottom: ".25rem" }}>
          Configure sua imobiliária
        </h1>
        <p className="subtle text-sm" style={{ marginBottom: "1.5rem" }}>
          Só faltam alguns dados para criar seu espaço.
        </p>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <label style={fieldStyle}>
            <span className="text-sm">Nome da imobiliária</span>
            <input name="name" required minLength={2} className="input" placeholder="Imobiliária Move" />
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
