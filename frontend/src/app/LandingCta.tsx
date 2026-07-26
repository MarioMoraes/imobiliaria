"use client";

import Link from "next/link";
import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";

/**
 * CTAs da landing ("Entrar" / "Criar conta").
 *
 * Por que isto é Client Component e não JSX solto na página: `mode="modal"`
 * chama `clerk.openSignIn()`, que é **no-op quando já existe sessão ativa** — o
 * Clerk não abre o formulário para quem já está logado e não mostra nada na
 * tela (só um warning no console). Se o visitante logado voltar à landing por
 * qualquer caminho (botão voltar, redirect que não completou, link direto), o
 * clique não faz nada e ele fica preso sem entender por quê. Aconteceu na
 * demonstração no cliente.
 *
 * Consultando `useAuth()` aqui, o mesmo par de botões vira um único "Ir para o
 * painel" quando a sessão existe. Não fazemos redirect automático de propósito:
 * se o servidor não enxergasse a sessão (relógio do container fora de hora,
 * cookie não persistido), o bounce automático faria ping-pong com o middleware.
 * Um link explícito nunca entra em laço.
 */
type Props = {
  className: string;
  children: React.ReactNode;
};

/** True só quando o Clerk já carregou E confirmou a sessão. */
function useSignedIn() {
  const { isLoaded, isSignedIn } = useAuth();
  return isLoaded && isSignedIn;
}

export function EntrarButton({ className, children }: Props) {
  const signedIn = useSignedIn();

  if (signedIn) {
    return (
      <Link href="/dashboard" className={className}>
        Ir para o painel
      </Link>
    );
  }

  return (
    <SignInButton mode="modal" forceRedirectUrl="/dashboard" signUpForceRedirectUrl="/onboarding">
      <button type="button" className={className}>
        {children}
      </button>
    </SignInButton>
  );
}

/**
 * O destino é `/onboarding` (não o painel): quem acabou de criar a conta ainda
 * precisa cadastrar a imobiliária. Para quem já tem sessão este botão some — o
 * "Ir para o painel" do `EntrarButton` ao lado já cobre o caso, e dois botões
 * idênticos lado a lado não ajudariam ninguém.
 */
export function CriarContaButton({ className, children }: Props) {
  const signedIn = useSignedIn();

  if (signedIn) return null;

  return (
    <SignUpButton mode="modal" forceRedirectUrl="/onboarding" signInForceRedirectUrl="/dashboard">
      <button type="button" className={className}>
        {children}
      </button>
    </SignUpButton>
  );
}
