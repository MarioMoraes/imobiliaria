import { withTenant } from "../../shared/db.js";
import type { UserRole, UserWithRoles } from "./user.schema.js";

/**
 * Acesso a dados de usuários do tenant. Tudo passa por `withTenant` (RLS): um
 * tenant nunca enxerga/edita usuários de outro.
 */

export async function listUsersWithRoles(tenantId: string): Promise<UserWithRoles[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      email: string;
      full_name: string;
      status: string;
      roles: string[];
    }>(
      `SELECT u.id, u.email, u.full_name, u.status,
              COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
        GROUP BY u.id
        ORDER BY u.created_at DESC`,
    );
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      status: r.status,
      roles: r.roles,
    }));
  });
}

/** Verifica se o usuário existe no tenant e devolve seu clerk_external_id. */
export async function findUserRef(
  tenantId: string,
  userId: string,
): Promise<{ clerkExternalId: string | null } | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ clerk_external_id: string | null }>(
      "SELECT clerk_external_id FROM users WHERE id = $1",
      [userId],
    );
    return rows[0] ? { clerkExternalId: rows[0].clerk_external_id } : null;
  });
}

/**
 * Define o papel do usuário (MVP: papel único — substitui os existentes) numa
 * única transação. Assume que o usuário já foi validado como pertencente ao tenant.
 */
export async function setUserRole(
  tenantId: string,
  userId: string,
  role: UserRole,
): Promise<UserWithRoles> {
  return withTenant(tenantId, async (client) => {
    await client.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
    await client.query(
      "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)",
      [tenantId, userId, role],
    );
    const { rows } = await client.query<{
      id: string;
      email: string;
      full_name: string;
      status: string;
    }>("SELECT id, email, full_name, status FROM users WHERE id = $1", [userId]);
    const u = rows[0]!;
    return { id: u.id, email: u.email, fullName: u.full_name, status: u.status, roles: [role] };
  });
}
