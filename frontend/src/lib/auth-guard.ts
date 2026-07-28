import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

/**
 * Exige sessão para renderizar uma área protegida. Server-side apenas.
 *
 * Substitui o gate por caminho que ficava no `middleware.ts` (`createRouteMatcher`
 * + `auth.protect()`), depreciado pelo Clerk: a proteção por path decide pela URL,
 * enquanto quem serve o dado é o Next — rewrites, rotas paralelas/interceptadas e
 * o `matcher` por extensão de arquivo podem divergir e deixar um recurso alcançável.
 * Aqui a checagem mora junto de quem lê o dado, então não há divergência possível.
 *
 * Usar no layout de cada área fechada; o gate vale para tudo abaixo dele.
 *
 * `redirect("/sign-in")` em vez de `auth.protect()`: em Server Component o
 * `protect()` levanta 404 para quem não está logado, e o comportamento que este
 * app tinha (via `unauthenticatedUrl`) era mandar ao login.
 */
export async function requireSession(): Promise<string> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return userId;
}
