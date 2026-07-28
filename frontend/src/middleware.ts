import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Middleware do Clerk (MOD-AUTH-05).
 *
 * Ele NÃO decide mais quem entra onde. O `clerkMiddleware()` continua necessário
 * porque é ele que resolve a sessão e disponibiliza o `auth()` para Server
 * Components, Route Handlers e Server Actions — mas a autorização passou para
 * junto do dado (`lib/auth-guard.ts`), como o Clerk recomenda desde a depreciação
 * do `createRouteMatcher`: uma lista de padrões de caminho pode divergir de como
 * o Next realmente roteia o request e deixar um recurso protegido alcançável.
 *
 * Onde ficam os gates agora:
 * - `app/(admin)/layout.tsx`     → exige sessão (painel da imobiliária).
 * - `app/superadmin/layout.tsx`  → exige sessão + admin da plataforma.
 * - `app/onboarding/layout.tsx`  → exige sessão (o sign-up acontece antes).
 * - Route Handlers e Server Actions → checam por conta própria; layouts não
 *   rodam para eles. O choke point das Server Actions é o `authHeaders()` em
 *   `lib/api.ts`, que se recusa a falar com o backend sem sessão em produção.
 *
 * Públicas por consequência (ninguém as protege): a landing "/", o login, o
 * cadastro e o aceite de convite — este último precisa mesmo ser público, porque
 * o convidado chega por e-mail ainda sem sessão.
 *
 * Em desenvolvimento sem chaves configuradas, o Clerk roda em "keyless mode":
 * o app sobe e provisiona uma instância temporária para você reivindicar.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Todas as rotas exceto arquivos estáticos e internos do Next.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
