import { withTenant } from "../../shared/db.js";
import type {
  CreatePropertyTypeInput,
  PropertyType,
} from "./property-type.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toPropertyType(row: Row): PropertyType {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listPropertyTypes(
  tenantId: string,
): Promise<PropertyType[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM property_types ORDER BY name ASC",
    );
    return rows.map(toPropertyType);
  });
}

export async function findByName(
  tenantId: string,
  name: string,
): Promise<PropertyType | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM property_types WHERE lower(name) = lower($1)",
      [name],
    );
    return rows[0] ? toPropertyType(rows[0]) : null;
  });
}

export async function insertPropertyType(
  tenantId: string,
  input: CreatePropertyTypeInput,
): Promise<PropertyType> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO property_types (tenant_id, name)
       VALUES ($1, $2)
       RETURNING *`,
      [tenantId, input.name],
    );
    return toPropertyType(rows[0]!);
  });
}
