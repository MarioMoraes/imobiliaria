import { withTenant } from "../../shared/db.js";
import type {
  CreatePayableInput,
  ListPayablesQuery,
  OwnerPayout,
  Payable,
  PayableSummary,
  PatchPayableInput,
} from "./payable.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  contract_id: string | null;
  property_id: string | null;
  receivable_id: string | null;
  payee_person_id: string;
  payee_name: string | null;
  property_code: number | null;
  kind: string;
  description: string | null;
  competence: string | null;
  share_percent: string | number;
  gross_cents: string | number;
  admin_fee_percent: string | number;
  admin_fee_cents: string | number;
  amount_cents: string | number;
  due_date: string;   // DATE -> string (ver setTypeParser em shared/db.ts)
  status: string;
  paid_at: string | null;
  paid_amount_cents: string | number | null;
  asaas_transfer_id: string | null;
  transfer_status: string | null;
  transfer_failed_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

function toPayable(row: Row): Payable {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contractId: row.contract_id,
    propertyId: row.property_id,
    receivableId: row.receivable_id,
    payeePersonId: row.payee_person_id,
    payeeName: row.payee_name,
    propertyCode: row.property_code,
    kind: row.kind,
    description: row.description,
    competence: row.competence,
    sharePercent: Number(row.share_percent),
    grossCents: Number(row.gross_cents),
    adminFeePercent: Number(row.admin_fee_percent),
    adminFeeCents: Number(row.admin_fee_cents),
    amountCents: Number(row.amount_cents),
    dueDate: row.due_date,
    status: row.status,
    paidAt: row.paid_at,
    paidAmountCents: row.paid_amount_cents === null ? null : Number(row.paid_amount_cents),
    asaasTransferId: row.asaas_transfer_id,
    transferStatus: row.transfer_status,
    transferFailedReason: row.transfer_failed_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Nome do proprietário e código do imóvel vêm por LEFT JOIN. O código (e não o
 * título) é o que identifica o imóvel na operação — é curto, é o que aparece nos
 * outros cadastros, e cabe numa coluna de tabela.
 */
const SELECT = `
  SELECT p.*, ps.full_name AS payee_name, pr.code AS property_code
    FROM payables p
    LEFT JOIN persons    ps ON ps.id = p.payee_person_id
    LEFT JOIN properties pr ON pr.id = p.property_id`;

/** Sem `payee_name`/`property_code` no RETURNING o mapeamento quebraria. */
const RETURNING = `RETURNING *, NULL::text AS payee_name, NULL::int AS property_code`;

export async function listPayables(
  tenantId: string,
  query: ListPayablesQuery,
): Promise<Payable[]> {
  return withTenant(tenantId, async (client) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };

    if (query.contractId) add("p.contract_id = ?", query.contractId);
    if (query.propertyId) add("p.property_id = ?", query.propertyId);
    if (query.payeePersonId) add("p.payee_person_id = ?", query.payeePersonId);
    if (query.status) add("p.status = ?", query.status);
    if (query.kind) add("p.kind = ?", query.kind);
    // Repasse avulso não tem competência; aí o mês de referência é o do
    // vencimento — sem o COALESCE ele nunca apareceria em mês nenhum.
    if (query.competence) {
      add("COALESCE(p.competence, to_char(p.due_date, 'YYYY-MM')) = ?", query.competence);
    }
    if (query.dueMonth) add("to_char(p.due_date, 'YYYY-MM') = ?", query.dueMonth);
    if (query.dueFrom) add("p.due_date >= ?", query.dueFrom);
    if (query.dueTo) add("p.due_date <= ?", query.dueTo);

    params.push(query.limit);
    const { rows } = await client.query<Row>(
      `${SELECT}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY p.due_date ASC, ps.full_name ASC
       LIMIT $${params.length}`,
      params,
    );
    return rows.map(toPayable);
  });
}

/**
 * Todos os lançamentos que VENCEM no período — a base do Relatório de Contas a
 * Pagar.
 *
 * Sem `LIMIT`, ao contrário de `listPayables`: a listagem da tela corta em 500
 * porque é filtrada na prática, mas um relatório que corta não fecha com o
 * total, e é para conferir o total que ele existe. CANCELADO/ESTORNADO ficam
 * fora — não são obrigação a pagar nem pagamento feito.
 */
export async function listPayablesByDueRange(
  tenantId: string,
  from: string,
  to: string,
): Promise<Payable[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `${SELECT}
        WHERE p.due_date >= $1::date AND p.due_date <= $2::date
          AND p.status NOT IN ('CANCELADO', 'ESTORNADO')
        ORDER BY p.due_date ASC, ps.full_name ASC`,
      [from, to],
    );
    return rows.map(toPayable);
  });
}

/**
 * Indicadores do mês, somados no banco.
 *
 * Tudo é filtrado pelo mês de **VENCIMENTO** — a mesma chave da listagem. O que
 * mantém os dois alinhados é usarem o mesmo recorte, e não qual recorte é: com
 * os cards somando por vencimento e a tabela por competência, "A pagar no mês"
 * aparecia zerado logo acima da linha que ele deveria estar somando (o repasse
 * vence no mês SEGUINTE ao pagamento do aluguel).
 *
 * Por isso `paid` também olha o vencimento, e não `paid_at`: um repasse que
 * vence em agosto e foi quitado em setembro pertence ao mês de agosto na tela.
 *
 * `pending_count` é a exceção deliberada: é o total em aberto da carteira, sem
 * mês, porque alimenta o badge da landing do Financeiro.
 */
export async function summarize(
  tenantId: string,
  month: string,
): Promise<PayableSummary> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      open: string;
      paid: string;
      overdue: string;
      overdue_count: string;
      admin_fee: string;
      pending_count: string;
    }>(
      `
      WITH base AS (
        SELECT p.*,
               to_char(p.due_date, 'YYYY-MM') = $1        AS no_mes,
               p.status IN ('ABERTO', 'VENCIDO')          AS em_aberto
          FROM payables p
      )
      SELECT
        COALESCE(sum(amount_cents) FILTER (WHERE no_mes AND em_aberto), 0) AS open,
        -- Só PAGO: PROCESSANDO é dinheiro em trânsito, não repassado. Ele fica
        -- fora deste card e do "a pagar" — é exatamente o estado intermediário.
        COALESCE(sum(COALESCE(paid_amount_cents, amount_cents)) FILTER (
          WHERE no_mes AND status = 'PAGO'), 0) AS paid,
        COALESCE(sum(amount_cents) FILTER (
          WHERE no_mes AND em_aberto AND due_date < CURRENT_DATE), 0) AS overdue,
        count(*) FILTER (
          WHERE no_mes AND em_aberto AND due_date < CURRENT_DATE) AS overdue_count,
        COALESCE(sum(admin_fee_cents) FILTER (
          WHERE no_mes AND status NOT IN ('CANCELADO', 'ESTORNADO')), 0) AS admin_fee,
        count(*) FILTER (WHERE em_aberto) AS pending_count
        FROM base
      `,
      [month],
    );

    const row = rows[0];
    return {
      month,
      openCents: Number(row?.open ?? 0),
      paidCents: Number(row?.paid ?? 0),
      overdueCents: Number(row?.overdue ?? 0),
      overdueCount: Number(row?.overdue_count ?? 0),
      adminFeeCents: Number(row?.admin_fee ?? 0),
      pendingCount: Number(row?.pending_count ?? 0),
    };
  });
}

export async function findPayable(tenantId: string, id: string): Promise<Payable | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(`${SELECT} WHERE p.id = $1`, [id]);
    return rows[0] ? toPayable(rows[0]) : null;
  });
}

export async function insertPayable(
  tenantId: string,
  input: CreatePayableInput,
): Promise<Payable> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO payables
         (tenant_id, contract_id, property_id, payee_person_id, kind,
          description, competence, gross_cents, amount_cents, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
       ${RETURNING}`,
      [
        tenantId,
        input.contractId ?? null,
        input.propertyId ?? null,
        input.payeePersonId,
        input.kind,
        input.description ?? null,
        input.competence ?? null,
        input.amountCents,
        input.dueDate,
      ],
    );
    return toPayable(rows[0]!);
  });
}

/**
 * Grava os repasses de um aluguel de uma vez. `ON CONFLICT DO NOTHING` no índice
 * (receivable_id, payee_person_id) é o que torna a geração **idempotente**: a
 * mesma baixa reprocessada (webhook reentregue, botão de reconciliação) não paga
 * o proprietário duas vezes.
 *
 * Devolve quantos lançamentos foram realmente criados.
 */
export async function insertOwnerPayouts(
  tenantId: string,
  origin: {
    receivableId: string;
    contractId: string | null;
    propertyId: string | null;
  },
  payouts: OwnerPayout[],
): Promise<number> {
  if (payouts.length === 0) return 0;

  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `INSERT INTO payables
         (tenant_id, contract_id, property_id, receivable_id, payee_person_id,
          kind, description, competence, share_percent, gross_cents,
          admin_fee_percent, admin_fee_cents, amount_cents, due_date)
       SELECT $1, $2, $3, $4, o.payee_person_id, 'REPASSE', o.description,
              o.competence, o.share_percent, o.gross_cents,
              o.admin_fee_percent, o.admin_fee_cents, o.amount_cents,
              o.due_date::date
         FROM jsonb_to_recordset($5::jsonb) AS o(
              payee_person_id   uuid,
              description       text,
              competence        text,
              share_percent     numeric,
              gross_cents       bigint,
              admin_fee_percent numeric,
              admin_fee_cents   bigint,
              amount_cents      bigint,
              due_date          text)
       ON CONFLICT (receivable_id, payee_person_id)
         WHERE receivable_id IS NOT NULL
         DO NOTHING`,
      [
        tenantId,
        origin.contractId,
        origin.propertyId,
        origin.receivableId,
        // As chaves do JSON precisam bater com as colunas de jsonb_to_recordset.
        JSON.stringify(
          payouts.map((p) => ({
            payee_person_id: p.payeePersonId,
            description: p.description,
            competence: p.competence,
            share_percent: p.sharePercent,
            gross_cents: p.grossCents,
            admin_fee_percent: p.adminFeePercent,
            admin_fee_cents: p.adminFeeCents,
            amount_cents: p.amountCents,
            due_date: p.dueDate,
          })),
        ),
      ],
    );
    return rowCount ?? 0;
  });
}

export async function updatePayable(
  tenantId: string,
  id: string,
  input: PatchPayableInput,
): Promise<Payable | null> {
  const columns: Record<string, unknown> = {
    description: input.description,
    amount_cents: input.amountCents,
    due_date: input.dueDate,
    status: input.status,
    paid_at: input.paidAt,
    paid_amount_cents: input.paidAmountCents,
    transfer_status: input.transferStatus,
    transfer_failed_reason: input.transferFailedReason,
  };

  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [column, value] of Object.entries(columns)) {
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return findPayable(tenantId, id);

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `UPDATE payables SET ${sets.join(", ")}, updated_at = now()
        WHERE id = $1
        ${RETURNING}`,
      params,
    );
    return rows[0] ? toPayable(rows[0]) : null;
  });
}

/** Vincula o repasse à transferência criada no Asaas (chamado pelo MOD-PAY). */
/**
 * Amarra N lançamentos à MESMA transferência. Um PIX único paga vários repasses
 * do mesmo proprietário, então `asaas_transfer_id` não é chave: a correlação do
 * webhook (`listByTransferId`) devolve o conjunto.
 *
 * Uma UPDATE só, e não N: os lançamentos entram em PROCESSANDO juntos ou não
 * entram — metade marcada seria dinheiro enviado sem rastro no resto.
 */
export async function attachTransfer(
  tenantId: string,
  ids: string[],
  transfer: { asaasTransferId: string; transferStatus: string },
): Promise<Payable[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `UPDATE payables
          SET asaas_transfer_id = $2, transfer_status = $3,
              transfer_failed_reason = NULL, status = 'PROCESSANDO', updated_at = now()
        WHERE id = ANY($1::uuid[])
        ${RETURNING}`,
      [ids, transfer.asaasTransferId, transfer.transferStatus],
    );
    return rows.map(toPayable);
  });
}

/**
 * Repasses correspondentes a uma transferência do Asaas (correlação do webhook).
 * Devolve LISTA porque um PIX único cobre vários lançamentos — quando ele é
 * confirmado, todos precisam ser baixados.
 */
export async function listByTransferId(
  tenantId: string,
  asaasTransferId: string,
): Promise<Payable[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `${SELECT} WHERE p.asaas_transfer_id = $1 ORDER BY p.due_date ASC`,
      [asaasTransferId],
    );
    return rows.map(toPayable);
  });
}

/** Os lançamentos escolhidos na tela, na ordem de vencimento. */
export async function listPayablesByIds(
  tenantId: string,
  ids: string[],
): Promise<Payable[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `${SELECT} WHERE p.id = ANY($1::uuid[]) ORDER BY p.due_date ASC`,
      [ids],
    );
    return rows.map(toPayable);
  });
}

export async function deletePayable(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query("DELETE FROM payables WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  });
}

/** Um aluguel pago que ainda não gerou repasse (entrada da reconciliação). */
export interface PaidRentWithoutPayout {
  receivableId: string;
  contractId: string;
  propertyId: string;
  competence: string | null;
  amountCents: number;
  paidAt: string;
}

/**
 * Aluguéis já baixados que não têm repasse — leitura direta em `receivables`.
 *
 * É a mesma exceção que `dashboard/` já tem: um SELECT sobre a tabela de outro
 * módulo, sem escrita e sem regra. A alternativa (listar todos os aluguéis pagos
 * pelo service de receivables e cruzar em JS) esbarraria no limite da listagem
 * e traria a carteira inteira para a memória só para descartar quase tudo.
 */
export async function findPaidRentsWithoutPayout(
  tenantId: string,
  limit: number,
): Promise<PaidRentWithoutPayout[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      contract_id: string;
      property_id: string;
      competence: string | null;
      amount_cents: string | number;
      paid_at: string;
    }>(
      `SELECT r.id, r.contract_id, r.property_id, r.competence,
              r.amount_cents, r.paid_at
         FROM receivables r
        WHERE r.status = 'PAGO'
          AND r.kind = 'ALUGUEL'
          AND r.paid_at IS NOT NULL
          AND r.contract_id IS NOT NULL
          AND r.property_id IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM payables p WHERE p.receivable_id = r.id)
        ORDER BY r.paid_at ASC
        LIMIT $1`,
      [limit],
    );

    return rows.map((row) => ({
      receivableId: row.id,
      contractId: row.contract_id,
      propertyId: row.property_id,
      competence: row.competence,
      amountCents: Number(row.amount_cents),
      paidAt: row.paid_at,
    }));
  });
}
