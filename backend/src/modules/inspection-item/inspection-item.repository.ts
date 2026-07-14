import { withTenant } from "../../shared/db.js";
import type {
  CreateInspectionItemInput,
  InspectionItem,
} from "./inspection-item.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  description: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toInspectionItem(row: Row): InspectionItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    description: row.description,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listInspectionItems(
  tenantId: string,
): Promise<InspectionItem[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM inspection_items ORDER BY description ASC",
    );
    return rows.map(toInspectionItem);
  });
}

export async function findByDescription(
  tenantId: string,
  description: string,
): Promise<InspectionItem | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM inspection_items WHERE lower(description) = lower($1)",
      [description],
    );
    return rows[0] ? toInspectionItem(rows[0]) : null;
  });
}

export async function insertInspectionItem(
  tenantId: string,
  input: CreateInspectionItemInput,
): Promise<InspectionItem> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO inspection_items (tenant_id, description)
       VALUES ($1, $2)
       RETURNING *`,
      [tenantId, input.description],
    );
    return toInspectionItem(rows[0]!);
  });
}

/** Remove um item de vistoria do tenant. Retorna true se algo foi removido. */
export async function deleteInspectionItem(
  tenantId: string,
  id: string,
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      "DELETE FROM inspection_items WHERE id = $1",
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}
