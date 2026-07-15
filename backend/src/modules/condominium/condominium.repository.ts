import { withTenant } from "../../shared/db.js";
import type {
  Condominium,
  CreateCondominiumInput,
  UpdateCondominiumInput,
} from "./condominium.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  address: string | null;
  number: string | null;
  district: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  balance_cents: string; // BIGINT chega como string no pg
  admin_fee_percent: string; // NUMERIC chega como string
  admin_fee_fixed_cents: string;
  interest_percent: string;
  penalty_percent: string;
  created_at: Date;
  updated_at: Date;
}

function toCondominium(row: Row): Condominium {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    address: row.address,
    number: row.number,
    district: row.district,
    zip: row.zip,
    city: row.city,
    state: row.state,
    balanceCents: Number(row.balance_cents),
    adminFeePercent: Number(row.admin_fee_percent),
    adminFeeFixedCents: Number(row.admin_fee_fixed_cents),
    interestPercent: Number(row.interest_percent),
    penaltyPercent: Number(row.penalty_percent),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listCondominiums(tenantId: string): Promise<Condominium[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM condominiums ORDER BY name ASC",
    );
    return rows.map(toCondominium);
  });
}

export async function findById(
  tenantId: string,
  id: string,
): Promise<Condominium | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM condominiums WHERE id = $1",
      [id],
    );
    return rows[0] ? toCondominium(rows[0]) : null;
  });
}

export async function findByName(
  tenantId: string,
  name: string,
): Promise<Condominium | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM condominiums WHERE lower(name) = lower($1)",
      [name],
    );
    return rows[0] ? toCondominium(rows[0]) : null;
  });
}

export async function insertCondominium(
  tenantId: string,
  input: CreateCondominiumInput,
): Promise<Condominium> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO condominiums
         (tenant_id, name, address, number, district, zip, city, state,
          admin_fee_percent, admin_fee_fixed_cents, interest_percent, penalty_percent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        tenantId,
        input.name,
        input.address ?? null,
        input.number ?? null,
        input.district ?? null,
        input.zip ?? null,
        input.city ?? null,
        input.state ?? null,
        input.adminFeePercent,
        input.adminFeeFixedCents,
        input.interestPercent,
        input.penaltyPercent,
      ],
    );
    return toCondominium(rows[0]!);
  });
}

const COLUMN: Record<keyof UpdateCondominiumInput, string> = {
  name: "name",
  address: "address",
  number: "number",
  district: "district",
  zip: "zip",
  city: "city",
  state: "state",
  adminFeePercent: "admin_fee_percent",
  adminFeeFixedCents: "admin_fee_fixed_cents",
  interestPercent: "interest_percent",
  penaltyPercent: "penalty_percent",
};

export async function updateCondominium(
  tenantId: string,
  id: string,
  input: UpdateCondominiumInput,
): Promise<Condominium | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(COLUMN)) {
    const value = input[key as keyof UpdateCondominiumInput];
    if (value !== undefined) {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    }
  }
  if (sets.length === 0) return findById(tenantId, id);

  return withTenant(tenantId, async (client) => {
    values.push(id);
    const { rows } = await client.query<Row>(
      `UPDATE condominiums SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${values.length}
       RETURNING *`,
      values,
    );
    return rows[0] ? toCondominium(rows[0]) : null;
  });
}

/** Remove um condomínio do tenant. Retorna true se algo foi removido. */
export async function deleteCondominium(
  tenantId: string,
  id: string,
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      "DELETE FROM condominiums WHERE id = $1",
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}
