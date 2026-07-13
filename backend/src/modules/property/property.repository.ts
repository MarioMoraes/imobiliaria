import { withTenant } from "../../shared/db.js";
import type { PoolClient } from "pg";
import type { CreatePropertyInput, Property, PropertyOwner } from "./property.schema.js";

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
  purpose: string;
  property_type_id: string | null;
  is_development: boolean;
  status: string;
  price_cents: string | null;
  city: string | null;
  state: string | null;
  bedrooms: number | null;
  owners: PropertyOwner[] | null;
  created_at: Date;
  updated_at: Date;
}

// Subquery que agrega os donos (property_owners ⋈ persons) como jsonb — usada
// no list e no detalhe para trazer os proprietários sem N+1.
const OWNERS_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', po.id, 'personId', po.person_id,
      'personName', pe.full_name, 'sharePercent', po.share_percent
    ) ORDER BY pe.full_name) AS owners
    FROM property_owners po JOIN persons pe ON pe.id = po.person_id
    WHERE po.property_id = p.id
  ) o ON true`;

function toProperty(row: Row): Property {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    kind: row.kind,
    purpose: row.purpose,
    propertyTypeId: row.property_type_id,
    isDevelopment: row.is_development,
    status: row.status,
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    city: row.city,
    state: row.state,
    bedrooms: row.bedrooms,
    owners: (row.owners ?? []).map((o) => ({ ...o, sharePercent: Number(o.sharePercent) })),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadProperty(client: PoolClient, id: string): Promise<Property> {
  const { rows } = await client.query<Row>(
    `SELECT p.*, o.owners FROM properties p ${OWNERS_LATERAL} WHERE p.id = $1`,
    [id],
  );
  return toProperty(rows[0]!);
}

export async function listProperties(tenantId: string): Promise<Property[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT p.*, o.owners FROM properties p ${OWNERS_LATERAL}
        ORDER BY p.created_at DESC LIMIT 100`,
    );
    return rows.map(toProperty);
  });
}

export async function findProperty(
  tenantId: string,
  id: string,
): Promise<Property | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM properties WHERE id = $1",
      [id],
    );
    return rows[0] ? loadProperty(client, id) : null;
  });
}

/** Vincula (ou atualiza a participação de) um dono ao imóvel. Idempotente. */
export async function addOwner(
  tenantId: string,
  propertyId: string,
  personId: string,
  sharePercent: number,
): Promise<Property> {
  return withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO property_owners (tenant_id, property_id, person_id, share_percent)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (property_id, person_id)
       DO UPDATE SET share_percent = EXCLUDED.share_percent`,
      [tenantId, propertyId, personId, sharePercent],
    );
    return loadProperty(client, propertyId);
  });
}

export async function removeOwner(
  tenantId: string,
  propertyId: string,
  personId: string,
): Promise<Property> {
  return withTenant(tenantId, async (client) => {
    await client.query(
      "DELETE FROM property_owners WHERE property_id = $1 AND person_id = $2",
      [propertyId, personId],
    );
    return loadProperty(client, propertyId);
  });
}

export async function insertProperty(
  tenantId: string,
  input: CreatePropertyInput,
): Promise<Property> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO properties
         (tenant_id, title, kind, purpose, property_type_id, is_development, status, price_cents, city, state, bedrooms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        tenantId,
        input.title,
        input.kind,
        input.purpose,
        input.propertyTypeId ?? null,
        input.isDevelopment,
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
