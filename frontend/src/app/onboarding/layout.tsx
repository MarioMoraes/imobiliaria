import { requireSession } from "../../lib/auth-guard";

/**
 * O onboarding é para quem JÁ fez sign-up e ainda não tem imobiliária — logo,
 * exige sessão. Este layout existe só para carregar esse gate: a página em si é
 * Client Component (usa `setActive` do Clerk) e não pode chamar `auth()`.
 */
export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return <>{children}</>;
}
