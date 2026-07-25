import { Suspense } from "react";
import type { Metadata } from "next";
import { AceitarConvite } from "./AceitarConvite";

export const metadata: Metadata = {
  title: "Aceitar convite — Offices AI Imobiliária",
};

/**
 * Destino do link "Aceitar convite" do e-mail (MOD-FUNC / MOD-AUTH-06). O Clerk
 * redireciona para cá com `__clerk_ticket` na URL; é AQUI que o ticket é trocado
 * por uma sessão — sem esta página o link abre o app e nada acontece.
 *
 * Server Component só para o `Suspense` que o `useSearchParams` exige.
 */
export default function AceitarConvitePage() {
  return (
    <Suspense
      fallback={
        <main className="auth-shell">
          <div className="auth-body">
            <span className="subtle text-sm">Carregando convite…</span>
          </div>
        </main>
      }
    >
      <AceitarConvite />
    </Suspense>
  );
}
