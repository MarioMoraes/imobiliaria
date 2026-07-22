import { withTenant } from "../../shared/db.js";
import type { Broker, CreateBrokerInput, UpdateBrokerInput } from "./broker.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  code: number;
  name: string;
  address: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  mobile: string | null;
  cpf: string | null;
  rg: string | null;
  commission_percent: string; // NUMERIC chega como string no pg
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toBroker(row: Row): Broker {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    address: row.address,
    district: row.district,
    city: row.city,
    state: row.state,
    zip: row.zip,
    phone: row.phone,
    mobile: row.mobile,
    cpf: row.cpf,
    rg: row.rg,
    commissionPercent: Number(row.commission_percent),
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listBrokers(tenantId: string): Promise<Broker[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>("SELECT * FROM brokers ORDER BY name ASC");
    return rows.map(toBroker);
  });
}

export async function findBrokerById(
  tenantId: string,
  id: string,
): Promise<Broker | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>("SELECT * FROM brokers WHERE id = $1", [id]);
    return rows[0] ? toBroker(rows[0]) : null;
  });
}

export async function insertBroker(
  tenantId: string,
  input: CreateBrokerInput,
): Promise<Broker> {
  return withTenant(tenantId, async (client) => {
    // Código sequencial por tenant: MAX(code)+1 (subquery escopada pela RLS).
    // A transação do withTenant serializa inserções concorrentes.
    const { rows } = await client.query<Row>(
      `INSERT INTO brokers
         (tenant_id, code, name, address, district, city, state, zip,
          phone, mobile, cpf, rg, commission_percent)
       VALUES ($1, (SELECT COALESCE(MAX(code), 0) + 1 FROM brokers),
               $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        tenantId,
        input.name,
        input.address ?? null,
        input.district ?? null,
        input.city ?? null,
        input.state ?? null,
        input.zip ?? null,
        input.phone ?? null,
        input.mobile ?? null,
        input.cpf ?? null,
        input.rg ?? null,
        input.commissionPercent,
      ],
    );
    return toBroker(rows[0]!);
  });
}

const COLUMN: Record<keyof UpdateBrokerInput, string> = {
  name: "name",
  address: "address",
  district: "district",
  city: "city",
  state: "state",
  zip: "zip",
  phone: "phone",
  mobile: "mobile",
  cpf: "cpf",
  rg: "rg",
  commissionPercent: "commission_percent",
};

export async function updateBroker(
  tenantId: string,
  id: string,
  input: UpdateBrokerInput,
): Promise<Broker | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(COLUMN)) {
    const value = input[key as keyof UpdateBrokerInput];
    if (value !== undefined) {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    }
  }
  if (sets.length === 0) return findBrokerById(tenantId, id);

  return withTenant(tenantId, async (client) => {
    values.push(id);
    const { rows } = await client.query<Row>(
      `UPDATE brokers SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${values.length}
       RETURNING *`,
      values,
    );
    return rows[0] ? toBroker(rows[0]) : null;
  });
}

/** Remove um corretor do tenant. Retorna true se algo foi removido. */
export async function deleteBroker(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query("DELETE FROM brokers WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  });
}
