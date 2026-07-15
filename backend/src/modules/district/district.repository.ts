import { withTenant } from "../../shared/db.js";
import type { District, CreateDistrictInput } from "./district.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toDistrict(row: Row): District {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listDistricts(tenantId: string): Promise<District[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM districts ORDER BY name ASC",
    );
    return rows.map(toDistrict);
  });
}

export async function findByName(
  tenantId: string,
  name: string,
): Promise<District | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM districts WHERE lower(name) = lower($1)",
      [name],
    );
    return rows[0] ? toDistrict(rows[0]) : null;
  });
}

export async function insertDistrict(
  tenantId: string,
  input: CreateDistrictInput,
): Promise<District> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO districts (tenant_id, name)
       VALUES ($1, $2)
       RETURNING *`,
      [tenantId, input.name],
    );
    return toDistrict(rows[0]!);
  });
}

/** Remove um bairro do tenant. Retorna true se algo foi removido. */
export async function deleteDistrict(
  tenantId: string,
  id: string,
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      "DELETE FROM districts WHERE id = $1",
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}
