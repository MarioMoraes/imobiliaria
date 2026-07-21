import { withTenant } from "../../shared/db.js";
import type {
  CreateReceivableInput,
  ListReceivablesQuery,
  Receivable,
  ScheduledInstallment,
  UpdateReceivableInput,
} from "./receivable.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  contract_id: string | null;
  property_id: string | null;
  payer_person_id: string | null;
  payer_name: string | null;
  kind: string;
  description: string | null;
  competence: string | null;
  installment: number | null;
  installments_total: number | null;
  amount_cents: string | number;
  due_date: Date;
  status: string;
  paid_at: Date | null;
  paid_amount_cents: string | number | null;
  asaas_charge_id: string | null;
  boleto_url: string | null;
  invoice_url: string | null;
  created_at: Date;
  updated_at: Date;
}

/** `DATE` volta como Date do pg; a API troca em string YYYY-MM-DD (sem fuso). */
const day = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

function toReceivable(row: Row): Receivable {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contractId: row.contract_id,
    propertyId: row.property_id,
    payerPersonId: row.payer_person_id,
    payerName: row.payer_name,
    kind: row.kind,
    description: row.description,
    competence: row.competence,
    installment: row.installment,
    installmentsTotal: row.installments_total,
    amountCents: Number(row.amount_cents),
    dueDate: day(row.due_date)!,
    status: row.status,
    paidAt: day(row.paid_at),
    paidAmountCents: row.paid_amount_cents === null ? null : Number(row.paid_amount_cents),
    asaasChargeId: row.asaas_charge_id,
    boletoUrl: row.boleto_url,
    invoiceUrl: row.invoice_url,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** O nome do pagador vem por LEFT JOIN — a listagem do financeiro precisa dele. */
const SELECT = `
  SELECT r.*, p.full_name AS payer_name
    FROM receivables r
    LEFT JOIN persons p ON p.id = r.payer_person_id`;

export async function listReceivables(
  tenantId: string,
  query: ListReceivablesQuery,
): Promise<Receivable[]> {
  return withTenant(tenantId, async (client) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };

    if (query.contractId) add("r.contract_id = ?", query.contractId);
    if (query.propertyId) add("r.property_id = ?", query.propertyId);
    if (query.status) add("r.status = ?", query.status);
    if (query.kind) add("r.kind = ?", query.kind);
    if (query.dueFrom) add("r.due_date >= ?", query.dueFrom);
    if (query.dueTo) add("r.due_date <= ?", query.dueTo);

    params.push(query.limit);
    const { rows } = await client.query<Row>(
      `${SELECT}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY r.due_date ASC, r.installment ASC
       LIMIT $${params.length}`,
      params,
    );
    return rows.map(toReceivable);
  });
}

export async function findReceivable(
  tenantId: string,
  id: string,
): Promise<Receivable | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(`${SELECT} WHERE r.id = $1`, [id]);
    return rows[0] ? toReceivable(rows[0]) : null;
  });
}

export async function insertReceivable(
  tenantId: string,
  input: CreateReceivableInput,
): Promise<Receivable> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO receivables
         (tenant_id, contract_id, property_id, payer_person_id, kind,
          description, competence, amount_cents, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *, NULL::text AS payer_name`,
      [
        tenantId,
        input.contractId ?? null,
        input.propertyId ?? null,
        input.payerPersonId ?? null,
        input.kind,
        input.description ?? null,
        input.competence ?? null,
        input.amountCents,
        input.dueDate,
      ],
    );
    return toReceivable(rows[0]!);
  });
}

/**
 * Grava as parcelas do contrato de uma vez. `ON CONFLICT DO NOTHING` no índice
 * (contract_id, kind, competence) é o que torna a geração **idempotente**: um
 * webhook reentregue pela ZapSign não duplica o aluguel do mês.
 *
 * Devolve quantas parcelas foram realmente criadas.
 */
export async function insertRentSchedule(
  tenantId: string,
  contract: { contractId: string; propertyId: string | null; payerPersonId: string | null },
  installments: ScheduledInstallment[],
): Promise<number> {
  if (installments.length === 0) return 0;

  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `INSERT INTO receivables
         (tenant_id, contract_id, property_id, payer_person_id, kind,
          description, competence, installment, installments_total,
          amount_cents, due_date)
       SELECT $1, $2, $3, $4, 'ALUGUEL', i.description, i.competence,
              i.installment, i.installments_total, i.amount_cents, i.due_date::date
         FROM jsonb_to_recordset($5::jsonb) AS i(
              description        text,
              competence         text,
              installment        int,
              installments_total int,
              amount_cents       bigint,
              due_date           text)
       ON CONFLICT (contract_id, kind, competence)
         WHERE contract_id IS NOT NULL AND competence IS NOT NULL
         DO NOTHING`,
      [
        tenantId,
        contract.contractId,
        contract.propertyId,
        contract.payerPersonId,
        // As chaves do JSON precisam bater com as colunas de jsonb_to_recordset.
        JSON.stringify(
          installments.map((i) => ({
            description: i.description,
            competence: i.competence,
            installment: i.installment,
            installments_total: i.installmentsTotal,
            amount_cents: i.amountCents,
            due_date: i.dueDate,
          })),
        ),
      ],
    );
    return rowCount ?? 0;
  });
}

export async function updateReceivable(
  tenantId: string,
  id: string,
  input: UpdateReceivableInput,
): Promise<Receivable | null> {
  const columns: Record<string, unknown> = {
    description: input.description,
    amount_cents: input.amountCents,
    due_date: input.dueDate,
    status: input.status,
    paid_at: input.paidAt,
    paid_amount_cents: input.paidAmountCents,
  };

  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [column, value] of Object.entries(columns)) {
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return findReceivable(tenantId, id);

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `UPDATE receivables SET ${sets.join(", ")}, updated_at = now()
        WHERE id = $1
        RETURNING *, NULL::text AS payer_name`,
      params,
    );
    return rows[0] ? toReceivable(rows[0]) : null;
  });
}

/** Vincula a parcela à cobrança emitida no Asaas (chamado pelo MOD-FIN/pagamento). */
export async function attachCharge(
  tenantId: string,
  id: string,
  charge: { asaasChargeId: string; boletoUrl: string | null; invoiceUrl: string | null },
): Promise<Receivable | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `UPDATE receivables
          SET asaas_charge_id = $2, boleto_url = $3, invoice_url = $4, updated_at = now()
        WHERE id = $1
        RETURNING *, NULL::text AS payer_name`,
      [id, charge.asaasChargeId, charge.boletoUrl, charge.invoiceUrl],
    );
    return rows[0] ? toReceivable(rows[0]) : null;
  });
}

/** Parcela correspondente a uma cobrança do Asaas (correlação do webhook). */
export async function findByChargeId(
  tenantId: string,
  asaasChargeId: string,
): Promise<Receivable | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `${SELECT} WHERE r.asaas_charge_id = $1`,
      [asaasChargeId],
    );
    return rows[0] ? toReceivable(rows[0]) : null;
  });
}

export async function deleteReceivable(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query("DELETE FROM receivables WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  });
}

/**
 * Cancela as parcelas ABERTAS de um contrato a partir de uma data (rescisão) —
 * as já pagas ficam intactas, que é o histórico financeiro.
 */
export async function cancelOpenByContract(
  tenantId: string,
  contractId: string,
  fromDate?: string,
): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE receivables
          SET status = 'CANCELADO', updated_at = now()
        WHERE contract_id = $1
          AND status IN ('ABERTO', 'VENCIDO')
          AND ($2::date IS NULL OR due_date >= $2::date)`,
      [contractId, fromDate ?? null],
    );
    return rowCount ?? 0;
  });
}
