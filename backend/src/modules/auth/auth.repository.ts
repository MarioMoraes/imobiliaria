import { pool } from "../../shared/db.js";
import type { Tenant } from "../tenant/tenant.schema.js";
import type { OnboardedUser, OnboardingInput } from "./auth.schema.js";

/**
 * Acesso a dados do onboarding. `createTenantWithAdmin` roda tenant + primeiro
 * usuário + papel em UMA transação, e por isso precisa dos DOIS escopos de RLS
 * na mesma transação:
 *  - `app.platform = 'on'` para inserir em `tenants` (a linha ainda não existe,
 *    então a condição `id = app.tenant_id` da policy não teria como valer);
 *  - `app.tenant_id = <novo tenant>` para inserir em `users`/`user_roles`.
 * Depois de definido o `app.tenant_id`, a policy de `tenants` também passa a
 * valer pelo primeiro braço — o `app.platform` só é necessário para o INSERT.
 */

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  cnpj: string | null;
  creci: string | null;
  domain: string | null;
  logo_url: string | null;
  plan: string;
  status: Tenant["status"];
  clerk_org_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  status: string;
}

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    cnpj: row.cnpj,
    creci: row.creci,
    domain: row.domain,
    logoUrl: row.logo_url,
    plan: row.plan,
    status: row.status,
    clerkOrgId: row.clerk_org_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Admin resolvido (da sessão Clerk ou do payload no dev-mode). */
export interface AdminIdentity {
  email: string;
  fullName: string;
}

/** Vínculo opcional com o Clerk (fluxo autenticado). */
export interface ClerkLink {
  clerkUserId: string;
  clerkOrgId: string;
}

export async function createTenantWithAdmin(
  input: OnboardingInput,
  admin: AdminIdentity,
  link?: ClerkLink,
): Promise<{ tenant: Tenant; user: OnboardedUser }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Escopo de plataforma: sem ele a policy de `tenants` recusa o INSERT.
    await client.query("SELECT set_config('app.platform', 'on', true)");

    const { rows: tenantRows } = await client.query<TenantRow>(
      `INSERT INTO tenants (name, slug, cnpj, creci, plan, status, clerk_org_id)
       VALUES ($1, $2, $3, $4, $5, 'trial', $6)
       RETURNING *`,
      [
        input.studio.name,
        input.studio.slug,
        input.studio.cnpj,
        input.studio.creci ?? null,
        input.planId ?? "free",
        link?.clerkOrgId ?? null,
      ],
    );
    const tenant = toTenant(tenantRows[0]!);

    // A partir daqui as tabelas com RLS exigem o tenant corrente na transação.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);

    const { rows: userRows } = await client.query<UserRow>(
      `INSERT INTO users (tenant_id, clerk_external_id, email, full_name, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, tenant_id, email, full_name, status`,
      [tenant.id, link?.clerkUserId ?? null, admin.email, admin.fullName],
    );
    const userRow = userRows[0]!;

    await client.query(
      `INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, 'ADMIN')`,
      [tenant.id, userRow.id],
    );

    await client.query("COMMIT");

    const user: OnboardedUser = {
      id: userRow.id,
      tenantId: userRow.tenant_id,
      email: userRow.email,
      fullName: userRow.full_name,
      roles: ["ADMIN"],
      status: userRow.status,
    };
    return { tenant, user };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
