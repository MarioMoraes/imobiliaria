import { lockSequence, withTenant } from "../../shared/db.js";
import type {
  Condominium,
  CondominiumExpense,
  CreateCondominiumInput,
  CreateExpenseInput,
  UpdateCondominiumInput,
  UpdateExpenseInput,
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

/* ───────────────────────── Despesas do condomínio ────────────────────────── */

interface ExpenseRow {
  id: string;
  tenant_id: string;
  condominium_id: string;
  seq: number | null;
  entry_date: string | null; // castado p/ text no SELECT (evita shift de fuso)
  event_id: string | null;
  event_name: string | null; // via LEFT JOIN events
  amount_cents: string; // BIGINT chega como string
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function toExpense(row: ExpenseRow): CondominiumExpense {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    condominiumId: row.condominium_id,
    seq: row.seq,
    entryDate: row.entry_date,
    eventId: row.event_id,
    eventName: row.event_name,
    amountCents: Number(row.amount_cents),
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// Nome do evento vem por LEFT JOIN (o evento é opcional). `entry_date::text`
// evita que o parser do pg desloque o dia por fuso horário.
const EXPENSE_COLS = `e.id, e.tenant_id, e.condominium_id, e.seq,
  e.entry_date::text AS entry_date, e.event_id, ev.name AS event_name,
  e.amount_cents, e.notes, e.created_at, e.updated_at`;

export async function listExpenses(
  tenantId: string,
  condominiumId: string,
): Promise<CondominiumExpense[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<ExpenseRow>(
      `SELECT ${EXPENSE_COLS}
         FROM condominium_expenses e
         LEFT JOIN events ev ON ev.id = e.event_id
        WHERE e.condominium_id = $1
        ORDER BY e.seq DESC NULLS LAST, e.created_at DESC`,
      [condominiumId],
    );
    return rows.map(toExpense);
  });
}

export async function insertExpense(
  tenantId: string,
  condominiumId: string,
  input: CreateExpenseInput,
): Promise<CondominiumExpense> {
  return withTenant(tenantId, async (client) => {
    // "Lancto nº" sequencial por tenant: MAX(seq)+1 (subquery escopada pela RLS).
    // A transação do withTenant serializa inserções concorrentes.
    // Serializa a geração do "Lancto nº" deste tenant (ver `lockSequence`).
    await lockSequence(client, tenantId, "condominium_expenses.seq");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO condominium_expenses
         (tenant_id, condominium_id, seq, entry_date, event_id, amount_cents, notes)
       VALUES ($1, $2,
         (SELECT COALESCE(MAX(seq), 0) + 1 FROM condominium_expenses),
         $3, $4, $5, $6)
       RETURNING id`,
      [
        tenantId,
        condominiumId,
        input.entryDate ?? null,
        input.eventId ?? null,
        input.amountCents,
        input.notes ?? null,
      ],
    );
    // Recarrega com o nome do evento (via JOIN) no formato canônico.
    const { rows: full } = await client.query<ExpenseRow>(
      `SELECT ${EXPENSE_COLS}
         FROM condominium_expenses e
         LEFT JOIN events ev ON ev.id = e.event_id
        WHERE e.id = $1`,
      [rows[0]!.id],
    );
    return toExpense(full[0]!);
  });
}

const EXPENSE_COLUMN: Record<keyof UpdateExpenseInput, string> = {
  entryDate: "entry_date",
  eventId: "event_id",
  amountCents: "amount_cents",
  notes: "notes",
};

export async function updateExpense(
  tenantId: string,
  condominiumId: string,
  expenseId: string,
  input: UpdateExpenseInput,
): Promise<CondominiumExpense | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(EXPENSE_COLUMN)) {
    const value = input[key as keyof UpdateExpenseInput];
    if (value !== undefined) {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    }
  }

  return withTenant(tenantId, async (client) => {
    if (sets.length > 0) {
      values.push(expenseId, condominiumId);
      const { rowCount } = await client.query(
        `UPDATE condominium_expenses SET ${sets.join(", ")}, updated_at = now()
          WHERE id = $${values.length - 1} AND condominium_id = $${values.length}`,
        values,
      );
      if ((rowCount ?? 0) === 0) return null;
    }
    // Recarrega com o nome do evento (via JOIN) no formato canônico.
    const { rows } = await client.query<ExpenseRow>(
      `SELECT ${EXPENSE_COLS}
         FROM condominium_expenses e
         LEFT JOIN events ev ON ev.id = e.event_id
        WHERE e.id = $1 AND e.condominium_id = $2`,
      [expenseId, condominiumId],
    );
    return rows[0] ? toExpense(rows[0]) : null;
  });
}

/** Remove uma despesa do condomínio. Retorna true se algo foi removido. */
export async function deleteExpense(
  tenantId: string,
  condominiumId: string,
  expenseId: string,
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      "DELETE FROM condominium_expenses WHERE id = $1 AND condominium_id = $2",
      [expenseId, condominiumId],
    );
    return (rowCount ?? 0) > 0;
  });
}
