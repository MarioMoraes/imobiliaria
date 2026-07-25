"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  SignIn,
  SignUp,
  useClerk,
  useOrganization,
  useOrganizationList,
  useUser,
} from "@clerk/nextjs";
import { Icon } from "@/components/Icon";

/** Depois de autenticar, o Clerk volta para cá — agora logado e sem ticket. */
const RETURN_TO = "/aceitar-convite";

/**
 * Aceite de convite de membro. O Clerk anexa dois parâmetros ao voltar do
 * e-mail:
 *
 * - `__clerk_ticket`: o ticket a ser trocado. É o `<SignIn>`/`<SignUp>` que o
 *   consome (os mesmos componentes do Account Portal), o que também aceita o
 *   convite da organização — daí o membro deixar de ficar "pendente".
 * - `__clerk_status`: `sign_up` (o e-mail convidado ainda não tem conta),
 *   `sign_in` (já tem) ou `complete` (o próprio convidado já estava logado e o
 *   Clerk já aplicou o convite).
 *
 * ORDEM IMPORTA: enquanto houver ticket na URL, ele manda. Tratar "já está
 * logado" antes engoliria o convite de quem abre o link no navegador do admin —
 * a tela iria para o painel e o convite continuaria pendente, sem nenhum erro.
 */
export function AceitarConvite() {
  const params = useSearchParams();
  const ticket = params.get("__clerk_ticket");
  const status = params.get("__clerk_status");
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return <Shell>Carregando convite…</Shell>;
  }

  // O Clerk já aplicou o convite (o convidado abriu o link logado na conta
  // certa): só falta ativar a organização e seguir.
  if (status === "complete") {
    return <Finalizar />;
  }

  if (ticket) {
    // Sessão ativa bloqueia o formulário do Clerk — e a sessão pode ser de
    // outra pessoa (o admin que convidou). Sair é o único caminho honesto.
    return isSignedIn ? <TrocarDeConta /> : <Autenticar status={status} />;
  }

  // Sem ticket: ou é o retorno pós-autenticação (logado), ou um link velho.
  return isSignedIn ? <Finalizar /> : <LinkInvalido />;
}

/** Formulário do Clerk que consome o ticket da URL. */
function Autenticar({ status }: { status: string | null }) {
  return (
    <main className="auth-shell">
      <Marca />
      <div className="auth-body">
        {status === "sign_in" ? (
          <SignIn routing="hash" forceRedirectUrl={RETURN_TO} signUpUrl="/sign-up" />
        ) : (
          <SignUp routing="hash" forceRedirectUrl={RETURN_TO} signInUrl="/sign-in" />
        )}
      </div>
    </main>
  );
}

/**
 * Alguém já logado abriu um convite. Caso clássico: o admin testa o link no
 * próprio navegador. Precisa sair para que o convite entre na conta certa — o
 * ticket é preservado na URL de retorno.
 */
function TrocarDeConta() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [saindo, setSaindo] = useState(false);
  const email = user?.primaryEmailAddress?.emailAddress ?? "outra conta";

  function sair() {
    setSaindo(true);
    const voltarPara = `${window.location.pathname}${window.location.search}`;
    void signOut({ redirectUrl: voltarPara });
  }

  return (
    <Shell>
      <strong>Você já está conectado</strong>
      <p className="text-sm subtle">
        Esta sessão é de <b>{email}</b>. O convite precisa ser aceito na conta
        para a qual ele foi enviado.
      </p>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={sair}
        disabled={saindo}
        style={{ marginTop: 12 }}
      >
        {saindo ? "Saindo…" : "Sair e aceitar o convite"}
      </button>
      <Link href="/dashboard" className="text-sm subtle" style={{ marginTop: 8 }}>
        Continuar como {email}
      </Link>
    </Shell>
  );
}

/**
 * Último passo: garantir que a imobiliária do convite é a organização ATIVA da
 * sessão. Sem isso o token sai sem o claim `tenant_id` e o backend recusa todo
 * request /v1 — o membro entraria e veria erro em vez do painel.
 */
function Finalizar() {
  const router = useRouter();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const { isLoaded: listLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: true,
  });
  const [semVinculo, setSemVinculo] = useState(false);

  useEffect(() => {
    if (!orgLoaded || !listLoaded || userMemberships.isLoading) return;

    // Já com organização ativa (caso comum: o próprio aceite a ativa).
    if (organization) {
      router.replace("/dashboard");
      return;
    }

    const first = userMemberships.data?.[0];
    if (!first) {
      setSemVinculo(true);
      return;
    }

    let cancelado = false;
    void setActive({ organization: first.organization.id }).then(() => {
      if (!cancelado) router.replace("/dashboard");
    });
    return () => {
      cancelado = true;
    };
  }, [orgLoaded, listLoaded, organization, userMemberships.isLoading, userMemberships.data, setActive, router]);

  if (semVinculo) {
    return (
      <Shell>
        <p className="text-sm">
          Sua conta foi criada, mas ainda não está vinculada a nenhuma
          imobiliária. Peça ao administrador para reenviar o convite.
        </p>
        <Link href="/sign-in" className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>
          Ir para o login
        </Link>
      </Shell>
    );
  }

  return <Shell>Preparando seu acesso…</Shell>;
}

function LinkInvalido() {
  return (
    <Shell>
      <p className="text-sm">
        Este link de convite não é válido ou já foi utilizado. Peça um novo
        convite ao administrador da imobiliária.
      </p>
      <Link href="/sign-in" className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>
        Ir para o login
      </Link>
    </Shell>
  );
}

function Marca() {
  return (
    <Link href="/" className="auth-back">
      <span className="stat-icon">
        <Icon name="building" />
      </span>
      Offices AI Imobiliária
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <Marca />
      <div className="auth-body">
        <div
          className="card card-pad stack"
          style={{ gap: 8, maxWidth: 420, textAlign: "center", alignItems: "center" }}
        >
          {children}
        </div>
      </div>
    </main>
  );
}
