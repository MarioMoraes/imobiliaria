import { auth } from "@clerk/nextjs/server";

/**
 * Administração da plataforma (área /superadmin). Server-side apenas.
 *
 * A allowlist é a MESMA do backend (`PLATFORM_ADMIN_CLERK_IDS`) — aqui ela só
 * decide se a UI aparece; o gate que importa é o `platformAdminHook` no backend,
 * porque as Server Actions chamam `/admin/tenants` diretamente. Manter as duas
 * pontas na mesma variável evita uma tela que carrega e depois estoura 403.
 *
 * Sem a variável definida, a área fica trancada (lista vazia nega todo mundo).
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const allowed = (process.env.PLATFORM_ADMIN_CLERK_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (allowed.length === 0) return false;

  try {
    const { userId } = await auth();
    return userId != null && allowed.includes(userId);
  } catch {
    // Sem contexto de request / Clerk não configurado — nega.
    return false;
  }
}
