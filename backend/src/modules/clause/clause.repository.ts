import { withTenant } from "../../shared/db.js";
import type { Clause, CreateClauseInput } from "./clause.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toClause(row: Row): Clause {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listClauses(tenantId: string): Promise<Clause[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM clauses ORDER BY name ASC",
    );
    return rows.map(toClause);
  });
}

export async function findByName(
  tenantId: string,
  name: string,
): Promise<Clause | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM clauses WHERE lower(name) = lower($1)",
      [name],
    );
    return rows[0] ? toClause(rows[0]) : null;
  });
}

export async function insertClause(
  tenantId: string,
  input: CreateClauseInput,
): Promise<Clause> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO clauses (tenant_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [tenantId, input.name, input.description],
    );
    return toClause(rows[0]!);
  });
}

/** Remove uma cláusula do tenant. Retorna true se algo foi removido. */
export async function deleteClause(
  tenantId: string,
  id: string,
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      "DELETE FROM clauses WHERE id = $1",
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}
