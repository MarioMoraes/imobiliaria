import { withTenant } from "../../shared/db.js";
import type {
  Commission,
  CommissionSplitEntry,
  CommissionSummary,
  CreateCommissionInput,
  ListCommissionsQuery,
  PatchCommissionInput,
} from "./commission.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  kind: string;
  party: string;
  property_id: string | null;
  property_code: number | null;
  contract_id: string | null;
  sale_id: string | null;
  broker_id: string | null;
  broker_name: string | null;
  description: string | null;
  base_cents: string | number;
  percent_snapshot: string | number;
  amount_cents: string | number;
  due_date: string; // DATE -> string (ver setTypeParser em shared/db.ts)
  status: string;
  settled_at: string | null;
  settled_amount_cents: string | number | null;
  created_at: Date;
  updated_at: Date;
}

function toCommission(row: Row): Commission {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind,
    party: row.party as Commission["party"],
    propertyId: row.property_id,
    propertyCode: row.property_code,
    contractId: row.contract_id,
    saleId: row.sale_id,
    brokerId: row.broker_id,
    brokerName: row.broker_name,
    description: row.description,
    baseCents: Number(row.base_cents),
    percentSnapshot: Number(row.percent_snapshot),
    amountCents: Number(row.amount_cents),
    dueDate: row.due_date,
    status: row.status,
    settledAt: row.settled_at,
    settledAmountCents:
      row.settled_amount_cents === null ? null : Number(row.settled_amount_cents),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Nome do corretor e código do imóvel por LEFT JOIN — mesma escolha de `payables`. */
const SELECT = `
  SELECT c.*, b.name AS broker_name, pr.code AS property_code
    FROM commissions c
    LEFT JOIN brokers    b  ON b.id  = c.broker_id
    LEFT JOIN properties pr ON pr.id = c.property_id`;

const RETURNING = `RETURNING *, NULL::text AS broker_name, NULL::int AS property_code`;

export async function listCommissions(
  tenantId: string,
  query: ListCommissionsQuery,
): Promise<Commission[]> {
  return withTenant(tenantId, async (client) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };

    if (query.status) add("c.status = ?", query.status);
    if (query.party) add("c.party = ?", query.party);
    if (query.kind) add("c.kind = ?", query.kind);
    if (query.brokerId) add("c.broker_id = ?", query.brokerId);
    if (query.propertyId) add("c.property_id = ?", query.propertyId);
    if (query.saleId) add("c.sale_id = ?", query.saleId);
    if (query.dueMonth) add("to_char(c.due_date, 'YYYY-MM') = ?", query.dueMonth);
    if (query.settledMonth) {
      add("to_char(c.settled_at, 'YYYY-MM') = ?", query.settledMonth);
    }

    params.push(query.limit);
    const { rows } = await client.query<Row>(
      `${SELECT}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY c.due_date ASC, c.created_at ASC
       LIMIT $${params.length}`,
      params,
    );
    return rows.map(toCommission);
  });
}

export async function findCommission(
  tenantId: string,
  id: string,
): Promise<Commission | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(`${SELECT} WHERE c.id = $1`, [id]);
    return rows[0] ? toCommission(rows[0]) : null;
  });
}

export async function insertCommission(
  tenantId: string,
  input: CreateCommissionInput & { amountCents: number },
): Promise<Commission> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO commissions
         (tenant_id, kind, party, property_id, contract_id, broker_id,
          description, base_cents, percent_snapshot, amount_cents, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ${RETURNING}`,
      [
        tenantId,
        input.kind,
        input.party,
        input.propertyId ?? null,
        input.contractId ?? null,
        input.brokerId ?? null,
        input.description ?? null,
        input.baseCents,
        input.percent,
        input.amountCents,
        input.dueDate,
      ],
    );
    return toCommission(rows[0]!);
  });
}

/**
 * Grava as partes de uma venda numa transação só. `ON CONFLICT DO NOTHING`
 * apoiado no único (sale_id, party, broker_id): reprocessar o fechamento não
 * pode pagar o corretor duas vezes. Devolve quantas linhas nasceram — 0 quer
 * dizer "já estava lançado", não erro.
 */
export async function insertSaleCommissions(
  tenantId: string,
  origin: { saleId: string; propertyId: string | null; contractId: string | null },
  entries: CommissionSplitEntry[],
): Promise<number> {
  if (entries.length === 0) return 0;

  return withTenant(tenantId, async (client) => {
    let created = 0;
    for (const entry of entries) {
      const { rowCount } = await client.query(
        `INSERT INTO commissions
           (tenant_id, kind, party, property_id, contract_id, sale_id, broker_id,
            description, base_cents, percent_snapshot, amount_cents, due_date)
         VALUES ($1, 'VENDA', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT DO NOTHING`,
        [
          tenantId,
          entry.party,
          origin.propertyId,
          origin.contractId,
          origin.saleId,
          entry.brokerId,
          entry.description,
          entry.baseCents,
          entry.percent,
          entry.amountCents,
          entry.dueDate,
        ],
      );
      created += rowCount ?? 0;
    }
    return created;
  });
}

export async function updateCommission(
  tenantId: string,
  id: string,
  input: PatchCommissionInput,
): Promise<Commission | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, val: unknown): void => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  if (input.description !== undefined) push("description", input.description ?? null);
  if (input.baseCents !== undefined) push("base_cents", input.baseCents);
  if (input.percent !== undefined) push("percent_snapshot", input.percent);
  if (input.amountCents !== undefined) push("amount_cents", input.amountCents);
  if (input.dueDate !== undefined) push("due_date", input.dueDate);
  if (input.brokerId !== undefined) push("broker_id", input.brokerId ?? null);
  if (input.propertyId !== undefined) push("property_id", input.propertyId ?? null);
  if (input.status !== undefined) push("status", input.status);
  if (input.settledAt !== undefined) push("settled_at", input.settledAt);
  if (input.settledAmountCents !== undefined) {
    push("settled_amount_cents", input.settledAmountCents);
  }

  return withTenant(tenantId, async (client) => {
    if (sets.length === 0) {
      const { rows } = await client.query<Row>(`${SELECT} WHERE c.id = $1`, [id]);
      return rows[0] ? toCommission(rows[0]) : null;
    }
    sets.push("updated_at = now()");
    values.push(id);
    const { rows } = await client.query<Row>(
      `UPDATE commissions SET ${sets.join(", ")}
        WHERE id = $${values.length}
        ${RETURNING}`,
      values,
    );
    return rows[0] ? toCommission(rows[0]) : null;
  });
}

export async function deleteCommission(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query("DELETE FROM commissions WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  });
}

/**
 * Indicadores do mês, agregados no banco. Somar a listagem no cliente não serve:
 * ela tem limite, e a partir daí os cards passariam a mentir em silêncio —
 * mesmo motivo documentado em `PayableSummary`.
 */
export async function summarize(
  tenantId: string,
  month: string,
): Promise<CommissionSummary> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      receivable_open: string;
      payable_open: string;
      received: string;
      paid: string;
      pending_count: string;
    }>(
      `
      WITH base AS (
        SELECT c.*,
               to_char(c.due_date, 'YYYY-MM')   = $1 AS vence_no_mes,
               to_char(c.settled_at, 'YYYY-MM') = $1 AS quitada_no_mes
          FROM commissions c
      )
      SELECT
        COALESCE(sum(amount_cents) FILTER (
          WHERE vence_no_mes AND status = 'ABERTO' AND party = 'IMOBILIARIA'), 0) AS receivable_open,
        COALESCE(sum(amount_cents) FILTER (
          WHERE vence_no_mes AND status = 'ABERTO' AND party = 'CORRETOR'), 0) AS payable_open,
        COALESCE(sum(COALESCE(settled_amount_cents, amount_cents)) FILTER (
          WHERE quitada_no_mes AND status = 'QUITADO' AND party = 'IMOBILIARIA'), 0) AS received,
        COALESCE(sum(COALESCE(settled_amount_cents, amount_cents)) FILTER (
          WHERE quitada_no_mes AND status = 'QUITADO' AND party = 'CORRETOR'), 0) AS paid,
        count(*) FILTER (WHERE status = 'ABERTO') AS pending_count
        FROM base
      `,
      [month],
    );

    const row = rows[0]!;
    return {
      month,
      receivableOpenCents: Number(row.receivable_open),
      payableOpenCents: Number(row.payable_open),
      receivedCents: Number(row.received),
      paidCents: Number(row.paid),
      pendingCount: Number(row.pending_count),
    };
  });
}
