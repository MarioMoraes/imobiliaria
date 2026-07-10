import { pool } from "../../shared/db.js";
import type {
  CreateTenantInput,
  Tenant,
  TenantStatus,
  UpdateTenantInput,
} from "./tenant.schema.js";

/**
 * Acesso a dados de tenants. Diferente dos módulos de domínio, usa o `pool`
 * diretamente (sem `withTenant`): `tenants` é nível-plataforma e não tem RLS.
 * O gate de acesso aqui é a autorização de Super Admin (a implementar), não o
 * isolamento por tenant.
 */

interface Row {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  plan: string;
  status: TenantStatus;
  created_at: Date;
  updated_at: Date;
}

function toTenant(row: Row): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    domain: row.domain,
    plan: row.plan,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listTenants(): Promise<Tenant[]> {
  const { rows } = await pool.query<Row>(
    "SELECT * FROM tenants ORDER BY created_at DESC LIMIT 200",
  );
  return rows.map(toTenant);
}

export async function findTenantById(id: string): Promise<Tenant | null> {
  const { rows } = await pool.query<Row>("SELECT * FROM tenants WHERE id = $1", [id]);
  return rows[0] ? toTenant(rows[0]) : null;
}

export async function findTenantBySlug(slug: string): Promise<Tenant | null> {
  const { rows } = await pool.query<Row>("SELECT * FROM tenants WHERE slug = $1", [slug]);
  return rows[0] ? toTenant(rows[0]) : null;
}

export async function insertTenant(input: CreateTenantInput): Promise<Tenant> {
  const { rows } = await pool.query<Row>(
    `INSERT INTO tenants (name, slug, domain, plan)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.name, input.slug, input.domain ?? null, input.plan],
  );
  return toTenant(rows[0]!);
}

export async function updateTenant(
  id: string,
  patch: UpdateTenantInput,
): Promise<Tenant | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(patch.name);
  }
  if (patch.domain !== undefined) {
    sets.push(`domain = $${i++}`);
    values.push(patch.domain);
  }
  if (patch.plan !== undefined) {
    sets.push(`plan = $${i++}`);
    values.push(patch.plan);
  }
  if (patch.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(patch.status);
  }
  if (sets.length === 0) return findTenantById(id);

  sets.push("updated_at = now()");
  values.push(id);

  const { rows } = await pool.query<Row>(
    `UPDATE tenants SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
    values,
  );
  return rows[0] ? toTenant(rows[0]) : null;
}
