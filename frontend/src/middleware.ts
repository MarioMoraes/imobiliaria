import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Middleware do Clerk (MOD-AUTH-05). Protege o painel interno, o super admin e
 * o onboarding (exige usuário já autenticado — o sign-up acontece antes). Só
 * login/cadastro são públicos.
 *
 * Em desenvolvimento sem chaves configuradas, o Clerk roda em "keyless mode":
 * o app sobe e provisiona uma instância temporária para você reivindicar.
 */
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    // Não autenticado → redireciona para o login (em vez de 404).
    await auth.protect({
      unauthenticatedUrl: new URL("/sign-in", req.url).toString(),
    });
  }
});

export const config = {
  matcher: [
    // Todas as rotas exceto arquivos estáticos e internos do Next.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
