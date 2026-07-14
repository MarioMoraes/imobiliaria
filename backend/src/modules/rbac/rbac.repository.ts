import { withTenant } from "../../shared/db.js";

/**
 * Resolve o usuário local (nosso `users.id`) e seus papéis a partir do id
 * externo do Clerk (`users.clerk_external_id`). Roda sob RLS do tenant, então
 * só enxerga linhas do próprio tenant. Se o usuário ainda não foi provisionado
 * no nosso banco, retorna `{ userId: null, roles: [] }` → o request cai em
 * "sem papel ativo" (ERR_AUTH_007), comportamento correto até o vínculo existir.
 */
export async function resolveUserAndRoles(
  tenantId: string,
  clerkExternalId: string,
): Promise<{ userId: string | null; roles: string[] }> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ user_id: string; role: string | null }>(
      `SELECT u.id AS user_id, ur.role
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.clerk_external_id = $1 AND u.status = 'active'`,
      [clerkExternalId],
    );
    if (rows.length === 0) return { userId: null, roles: [] };
    const userId = rows[0]!.user_id;
    const roles = rows.map((r) => r.role).filter((r): r is string => r !== null);
    return { userId, roles };
  });
}

/**
 * Vínculo de convite no 1º login (MOD-AUTH-06): casa a sessão do Clerk com a
 * `users` row `invited` do tenant por e-mail e a ativa, gravando o
 * `clerk_external_id`. Idempotente: o `WHERE ... clerk_external_id IS NULL AND
 * status='invited'` garante que só a primeira reivindicação surte efeito.
 * Retorna `{userId, roles}` se reivindicou; `null` se não havia convite a casar.
 */
export async function claimInvitedUser(
  tenantId: string,
  clerkExternalId: string,
  email: string,
): Promise<{ userId: string; roles: string[] } | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE users
          SET clerk_external_id = $1, status = 'active', updated_at = now()
        WHERE lower(email) = lower($2)
          AND clerk_external_id IS NULL
          AND status = 'invited'
        RETURNING id`,
      [clerkExternalId, email],
    );
    if (rows.length === 0) return null;
    const userId = rows[0]!.id;
    const { rows: roleRows } = await client.query<{ role: string }>(
      "SELECT role FROM user_roles WHERE user_id = $1",
      [userId],
    );
    return { userId, roles: roleRows.map((r) => r.role) };
  });
}
