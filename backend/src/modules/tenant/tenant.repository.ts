import { withPlatform, withTenant } from "../../shared/db.js";
import type {
  CreateTenantInput,
  Tenant,
  TenantStatus,
  UpdateTenantInput,
} from "./tenant.schema.js";

/**
 * Acesso a dados de tenants. `tenants` é a tabela de registro da plataforma, e a
 * policy de RLS dela aceita DUAS condições (ver infra/postgres/init.sql):
 * `id = app.tenant_id` (a própria imobiliária) ou `app.platform = 'on'`.
 *
 * Por isso as funções vêm em pares, e o sufixo importa:
 *  - sem sufixo  → `withTenant`, alcança só a linha do próprio tenant. É o que
 *    o autoatendimento (`/v1/tenant`) e o `assertActive` usam.
 *  - `AsPlatform` → `withPlatform`, atravessa tenants. Só para a área de Super
 *    Admin e para a unicidade global no onboarding (quando ainda não há tenant).
 *
 * Manter os dois caminhos separados é o que impede que um bug futuro no
 * autoatendimento leia o cadastro de outra imobiliária.
 */

interface Row {
  id: string;
  name: string;
  slug: string;
  cnpj: string | null;
  creci: string | null;
  domain: string | null;
  logo_url: string | null;
  plan: string;
  status: TenantStatus;
  clerk_org_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function toTenant(row: Row): Tenant {
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

export async function listTenantsAsPlatform(): Promise<Tenant[]> {
  return withPlatform(async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM tenants ORDER BY created_at DESC LIMIT 200",
    );
    return rows.map(toTenant);
  });
}

/**
 * A própria imobiliária. Roda sob `withTenant(id)`, então a policy só devolve a
 * linha quando `id` é o tenant corrente — se um dia alguém passar um id
 * arbitrário aqui, o resultado é "não encontrado", não o dado de outro cliente.
 */
export async function findTenantById(id: string): Promise<Tenant | null> {
  return withTenant(id, async (client) => {
    const { rows } = await client.query<Row>("SELECT * FROM tenants WHERE id = $1", [id]);
    return rows[0] ? toTenant(rows[0]) : null;
  });
}

export async function findTenantByIdAsPlatform(id: string): Promise<Tenant | null> {
  return withPlatform(async (client) => {
    const { rows } = await client.query<Row>("SELECT * FROM tenants WHERE id = $1", [id]);
    return rows[0] ? toTenant(rows[0]) : null;
  });
}

/** Unicidade global de slug/CNPJ: por definição atravessa tenants. */
export async function findTenantBySlug(slug: string): Promise<Tenant | null> {
  return withPlatform(async (client) => {
    const { rows } = await client.query<Row>("SELECT * FROM tenants WHERE slug = $1", [slug]);
    return rows[0] ? toTenant(rows[0]) : null;
  });
}

export async function findTenantByCnpj(cnpj: string): Promise<Tenant | null> {
  return withPlatform(async (client) => {
    const { rows } = await client.query<Row>("SELECT * FROM tenants WHERE cnpj = $1", [cnpj]);
    return rows[0] ? toTenant(rows[0]) : null;
  });
}

export async function insertTenantAsPlatform(input: CreateTenantInput): Promise<Tenant> {
  return withPlatform(async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO tenants (name, slug, domain, logo_url, plan)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.name, input.slug, input.domain ?? null, input.logoUrl ?? null, input.plan],
    );
    return toTenant(rows[0]!);
  });
}

/** Remove o tenant (cascata em users/user_roles). Só o rollback do onboarding usa. */
export async function deleteTenantAsPlatform(id: string): Promise<void> {
  await withPlatform(async (client) => {
    await client.query("DELETE FROM tenants WHERE id = $1", [id]);
  });
}

/** Edição pela plataforma: qualquer tenant, inclusive `status`/`plan`. */
export async function updateTenantAsPlatform(
  id: string,
  patch: UpdateTenantInput,
): Promise<Tenant | null> {
  const built = buildUpdate(patch);
  if (!built) return findTenantByIdAsPlatform(id);

  return withPlatform(async (client) => {
    const { rows } = await client.query<Row>(built.sql, [...built.values, id]);
    return rows[0] ? toTenant(rows[0]) : null;
  });
}

/** Edição pela própria imobiliária: a policy garante que só a própria linha muda. */
export async function updateCurrentTenant(
  tenantId: string,
  patch: UpdateTenantInput,
): Promise<Tenant | null> {
  const built = buildUpdate(patch);
  if (!built) return findTenantById(tenantId);

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(built.sql, [...built.values, tenantId]);
    return rows[0] ? toTenant(rows[0]) : null;
  });
}

/**
 * Monta o SET do UPDATE. `null` quando não há nada a mudar. O último placeholder
 * é sempre o id, que o caller acrescenta aos values.
 */
function buildUpdate(patch: UpdateTenantInput): { sql: string; values: unknown[] } | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(patch.name);
  }
  if (patch.cnpj !== undefined) {
    sets.push(`cnpj = $${i++}`);
    values.push(patch.cnpj);
  }
  if (patch.creci !== undefined) {
    sets.push(`creci = $${i++}`);
    values.push(patch.creci);
  }
  if (patch.domain !== undefined) {
    sets.push(`domain = $${i++}`);
    values.push(patch.domain);
  }
  if (patch.logoUrl !== undefined) {
    sets.push(`logo_url = $${i++}`);
    values.push(patch.logoUrl);
  }
  if (patch.plan !== undefined) {
    sets.push(`plan = $${i++}`);
    values.push(patch.plan);
  }
  if (patch.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(patch.status);
  }
  if (sets.length === 0) return null;

  sets.push("updated_at = now()");
  return {
    sql: `UPDATE tenants SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
    values,
  };
}
