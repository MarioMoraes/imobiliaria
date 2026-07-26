"use client";

import { useEffect, useState } from "react";
import { SignIn, useAuth, useClerk } from "@clerk/nextjs";

/**
 * O `<SignIn>` do Clerk se esconde quando já existe sessão NO NAVEGADOR e manda
 * o usuário para o painel. Se o SERVIDOR não reconhecer essa mesma sessão, o
 * middleware devolve para cá — e os dois ficam empurrando o usuário um para o
 * outro: /dashboard → /sign-in → /dashboard. O resultado é uma tela em branco
 * que não explica nada (aconteceu na demonstração no cliente).
 *
 * Aqui contamos quantas vezes chegamos nesta página já autenticados. Na segunda,
 * paramos de renderizar o formulário e mostramos o diagnóstico: navegador e
 * servidor discordam sobre a sessão, o que na prática é relógio fora de hora ou
 * o container sem acesso ao Clerk.
 *
 * O contador vive em `sessionStorage` porque cada volta do laço é uma navegação
 * completa (redirect do middleware), então estado em memória se perderia.
 */
const CHAVE_VOLTAS = "offices:sign-in-voltas";

export function SignInWidget() {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [emLaco, setEmLaco] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;

    // Chegou aqui sem sessão: é o caminho normal. Zera para não acusar laço numa
    // visita futura legítima.
    if (!isSignedIn) {
      sessionStorage.removeItem(CHAVE_VOLTAS);
      return;
    }

    const voltas = Number(sessionStorage.getItem(CHAVE_VOLTAS) ?? "0") + 1;
    sessionStorage.setItem(CHAVE_VOLTAS, String(voltas));
    if (voltas >= 2) setEmLaco(true);
  }, [isLoaded, isSignedIn]);

  if (emLaco) return <SessaoNaoReconhecida onSair={() => void signOut({ redirectUrl: "/" })} />;

  return (
    <SignIn
      signUpUrl="/sign-up"
      forceRedirectUrl="/dashboard"
      signUpForceRedirectUrl="/onboarding"
    />
  );
}

/**
 * Sair de verdade é a única saída que funciona pelo navegador: destrói a sessão
 * local e devolve o usuário a um estado consistente com o que o servidor vê.
 * As duas causas listadas são as que produzem esta divergência numa instalação
 * em Docker — estão na mesma ordem de probabilidade no LEIA-ME da demonstração.
 */
function SessaoNaoReconhecida({ onSair }: { onSair: () => void }) {
  return (
    <div className="card" style={{ width: "min(460px, 100%)", padding: "2rem" }}>
      <h1 style={{ fontFamily: "var(--font-poppins)", fontSize: "1.25rem", marginBottom: ".5rem" }}>
        Sessão não reconhecida pelo servidor
      </h1>
      <p className="subtle text-sm" style={{ marginBottom: "1rem" }}>
        Você está autenticado neste navegador, mas o servidor não validou a
        sessão — por isso o painel não abre.
      </p>

      <p className="text-sm" style={{ marginBottom: ".5rem" }}>Causas mais comuns:</p>
      <ul className="text-sm subtle" style={{ paddingLeft: "1.1rem", marginBottom: "1.5rem" }}>
        <li style={{ marginBottom: ".35rem" }}>
          O relógio do Docker está fora de hora (comum depois de suspender o
          computador). Reiniciar o Docker Desktop resolve.
        </li>
        <li>
          O servidor não alcança a internet para validar o login — proxy ou
          firewall da rede bloqueando o container.
        </li>
      </ul>

      <button type="button" className="btn btn-primary" onClick={onSair} style={{ width: "100%" }}>
        Sair e tentar de novo
      </button>
    </div>
  );
}
