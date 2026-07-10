import { withTenant } from "../../shared/db.js";
import type { CreatePropertyInput, Property } from "./property.schema.js";

/**
 * Acesso a dados de imóveis. Toda operação roda dentro de `withTenant`,
 * portanto o RLS garante que só linhas do tenant corrente são visíveis —
 * mesmo que o SQL não filtre explicitamente por tenant_id.
 */

interface Row {
  id: string;
  tenant_id: string;
  title: string;
  kind: string;
  status: string;
  price_cents: string | null;
  city: string | null;
  state: string | null;
  bedrooms: number | null;
  created_at: Date;
  updated_at: Date;
}

function toProperty(row: Row): Property {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    city: row.city,
    state: row.state,
    bedrooms: row.bedrooms,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listProperties(tenantId: string): Promise<Property[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM properties ORDER BY created_at DESC LIMIT 100",
    );
    return rows.map(toProperty);
  });
}

export async function findProperty(
  tenantId: string,
  id: string,
): Promise<Property | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM properties WHERE id = $1",
      [id],
    );
    return rows[0] ? toProperty(rows[0]) : null;
  });
}

export async function insertProperty(
  tenantId: string,
  input: CreatePropertyInput,
): Promise<Property> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO properties (tenant_id, title, kind, status, price_cents, city, state, bedrooms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        tenantId,
        input.title,
        input.kind,
        input.status,
        input.priceCents ?? null,
        input.city ?? null,
        input.state ?? null,
        input.bedrooms ?? null,
      ],
    );
    return toProperty(rows[0]!);
  });
}
