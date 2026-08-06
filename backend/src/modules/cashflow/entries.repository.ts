import { lockSequence, withTenant } from "../../shared/db.js";
import type {
  CashFlowCategory,
  CashFlowDirection,
  CashFlowEntry,
  CreateCashFlowCategoryInput,
  CreateCashFlowEntryInput,
  ListCashFlowEntriesQuery,
  UpdateCashFlowCategoryInput,
  UpdateCashFlowEntryInput,
} from "./cashflow.schema.js";

/**
 * As duas tabelas PRÓPRIAS do fluxo de caixa: a categoria e o lançamento manual.
 * Tudo o mais que aparece no extrato é derivado — ver `cashflow.repository.ts`.
 */

/* ------------------------------------------------------------ Categorias */

interface CategoryRow {
  id: string;
  tenant_id: string;
  code: number;
  name: string;
  direction: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toCategory(row: CategoryRow): CashFlowCategory {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    direction: row.direction as CashFlowDirection,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listCategories(tenantId: string): Promise<CashFlowCategory[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<CategoryRow>(
      "SELECT * FROM cash_flow_categories ORDER BY direction ASC, name ASC",
    );
    return rows.map(toCategory);
  });
}

export async function findCategory(
  tenantId: string,
  id: string,
): Promise<CashFlowCategory | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<CategoryRow>(
      "SELECT * FROM cash_flow_categories WHERE id = $1",
      [id],
    );
    return rows[0] ? toCategory(rows[0]) : null;
  });
}

export async function insertCategory(
  tenantId: string,
  input: CreateCashFlowCategoryInput,
): Promise<CashFlowCategory> {
  return withTenant(tenantId, async (client) => {
    // Código sequencial por tenant, como em `banks`: o lock serializa as
    // inserções concorrentes do MESMO tenant — a transação sozinha não faz isso.
    await lockSequence(client, tenantId, "cash_flow_categories.code");
    const { rows } = await client.query<CategoryRow>(
      `INSERT INTO cash_flow_categories (tenant_id, code, name, direction)
       VALUES ($1, (SELECT COALESCE(MAX(code), 0) + 1 FROM cash_flow_categories), $2, $3)
       RETURNING *`,
      [tenantId, input.name, input.direction],
    );
    return toCategory(rows[0]!);
  });
}

export async function updateCategory(
  tenantId: string,
  id: string,
  input: UpdateCashFlowCategoryInput,
): Promise<CashFlowCategory | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, val: unknown): void => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  if (input.name !== undefined) push("name", input.name);
  if (input.direction !== undefined) push("direction", input.direction);
  if (input.active !== undefined) push("active", input.active);

  return withTenant(tenantId, async (client) => {
    if (sets.length === 0) {
      const { rows } = await client.query<CategoryRow>(
        "SELECT * FROM cash_flow_categories WHERE id = $1",
        [id],
      );
      return rows[0] ? toCategory(rows[0]) : null;
    }
    sets.push("updated_at = now()");
    values.push(id);
    const { rows } = await client.query<CategoryRow>(
      `UPDATE cash_flow_categories SET ${sets.join(", ")}
        WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return rows[0] ? toCategory(rows[0]) : null;
  });
}

/**
 * Remove a categoria e SOLTA os lançamentos que a usavam (`category_id = NULL`),
 * em vez de recusar a remoção. O lançamento é o fato — quanto saiu, quando e
 * para quê está na descrição; a categoria é só o agrupamento. Apagar o histórico
 * junto seria destruir dado de caixa para arrumar um rótulo.
 */
export async function deleteCategory(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    await client.query(
      "UPDATE cash_flow_entries SET category_id = NULL, updated_at = now() WHERE category_id = $1",
      [id],
    );
    const { rowCount } = await client.query(
      "DELETE FROM cash_flow_categories WHERE id = $1",
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}

/* ------------------------------------------------- Lançamentos manuais */

interface EntryRow {
  id: string;
  tenant_id: string;
  entry_date: string; // DATE -> string
  direction: string;
  category_id: string | null;
  category_name: string | null;
  bank_id: string | null;
  bank_name: string | null;
  amount_cents: string | number;
  description: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function toEntry(row: EntryRow): CashFlowEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    entryDate: row.entry_date,
    direction: row.direction as CashFlowDirection,
    categoryId: row.category_id,
    categoryName: row.category_name,
    bankId: row.bank_id,
    bankName: row.bank_name,
    amountCents: Number(row.amount_cents),
    description: row.description,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT = `
  SELECT e.*, cat.name AS category_name, b.name AS bank_name
    FROM cash_flow_entries e
    LEFT JOIN cash_flow_categories cat ON cat.id = e.category_id
    LEFT JOIN banks b                  ON b.id   = e.bank_id`;

const RETURNING = `RETURNING *, NULL::text AS category_name, NULL::text AS bank_name`;

export async function listEntries(
  tenantId: string,
  query: ListCashFlowEntriesQuery,
): Promise<CashFlowEntry[]> {
  return withTenant(tenantId, async (client) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };

    if (query.month) add("to_char(e.entry_date, 'YYYY-MM') = ?", query.month);
    if (query.direction) add("e.direction = ?", query.direction);
    if (query.categoryId) add("e.category_id = ?", query.categoryId);

    params.push(query.limit);
    const { rows } = await client.query<EntryRow>(
      `${SELECT}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY e.entry_date DESC, e.created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows.map(toEntry);
  });
}

export async function findEntry(
  tenantId: string,
  id: string,
): Promise<CashFlowEntry | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<EntryRow>(`${SELECT} WHERE e.id = $1`, [id]);
    return rows[0] ? toEntry(rows[0]) : null;
  });
}

export async function insertEntry(
  tenantId: string,
  input: CreateCashFlowEntryInput,
): Promise<CashFlowEntry> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<EntryRow>(
      `INSERT INTO cash_flow_entries
         (tenant_id, entry_date, direction, category_id, bank_id,
          amount_cents, description, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ${RETURNING}`,
      [
        tenantId,
        input.entryDate,
        input.direction,
        input.categoryId ?? null,
        input.bankId ?? null,
        input.amountCents,
        input.description,
        input.notes ?? null,
      ],
    );
    return toEntry(rows[0]!);
  });
}

export async function updateEntry(
  tenantId: string,
  id: string,
  input: UpdateCashFlowEntryInput,
): Promise<CashFlowEntry | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, val: unknown): void => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  if (input.entryDate !== undefined) push("entry_date", input.entryDate);
  if (input.direction !== undefined) push("direction", input.direction);
  if (input.categoryId !== undefined) push("category_id", input.categoryId ?? null);
  if (input.bankId !== undefined) push("bank_id", input.bankId ?? null);
  if (input.amountCents !== undefined) push("amount_cents", input.amountCents);
  if (input.description !== undefined) push("description", input.description);
  if (input.notes !== undefined) push("notes", input.notes ?? null);

  return withTenant(tenantId, async (client) => {
    if (sets.length === 0) {
      const { rows } = await client.query<EntryRow>(`${SELECT} WHERE e.id = $1`, [id]);
      return rows[0] ? toEntry(rows[0]) : null;
    }
    sets.push("updated_at = now()");
    values.push(id);
    const { rows } = await client.query<EntryRow>(
      `UPDATE cash_flow_entries SET ${sets.join(", ")}
        WHERE id = $${values.length} ${RETURNING}`,
      values,
    );
    return rows[0] ? toEntry(rows[0]) : null;
  });
}

export async function deleteEntry(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      "DELETE FROM cash_flow_entries WHERE id = $1",
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}
