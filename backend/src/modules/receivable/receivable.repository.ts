import { withTenant } from "../../shared/db.js";
import type {
  CashFlowPoint,
  CondoChargeRow,
  CreateReceivableInput,
  ListReceivablesQuery,
  Receivable,
  ScheduledInstallment,
  PatchReceivableInput,
} from "./receivable.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  contract_id: string | null;
  condominium_id: string | null;
  property_id: string | null;
  payer_person_id: string | null;
  payer_name: string | null;
  kind: string;
  description: string | null;
  competence: string | null;
  installment: number | null;
  installments_total: number | null;
  amount_cents: string | number;
  due_date: string;   // DATE -> string (ver setTypeParser em shared/db.ts)
  status: string;
  paid_at: string | null;
  paid_amount_cents: string | number | null;
  asaas_charge_id: string | null;
  boleto_url: string | null;
  invoice_url: string | null;
  created_at: Date;
  updated_at: Date;
}

function toReceivable(row: Row): Receivable {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contractId: row.contract_id,
    condominiumId: row.condominium_id,
    propertyId: row.property_id,
    payerPersonId: row.payer_person_id,
    payerName: row.payer_name,
    kind: row.kind,
    description: row.description,
    competence: row.competence,
    installment: row.installment,
    installmentsTotal: row.installments_total,
    amountCents: Number(row.amount_cents),
    dueDate: row.due_date,
    status: row.status,
    paidAt: row.paid_at,
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

/**
 * `competence` filtra pelo mês de referência da cobrança. Nas parcelas geradas
 * ela vem preenchida; nas cobranças avulsas é nula, e aí o mês de referência é
 * o do vencimento — daí o COALESCE, senão uma avulsa nunca apareceria em
 * nenhum mês.
 */
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
    if (query.competence) {
      add("COALESCE(r.competence, to_char(r.due_date, 'YYYY-MM')) = ?", query.competence);
    }
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

/**
 * Todas as cobranças que VENCEM no período — a base do Relatório de Receitas.
 *
 * Sem `LIMIT`, ao contrário de `listReceivables`: a listagem da tela corta em
 * 500 porque é paginada na prática (o operador filtra), mas um relatório que
 * corta não fecha com o total, e é para conferir o total que ele existe. Um
 * trimestre de uma carteira média já passa dos 500.
 *
 * O recorte é o VENCIMENTO, e não a baixa: "as receitas de agosto" é o que
 * deveria entrar em agosto — a diferença para o que entrou é justamente a
 * inadimplência que o relatório precisa mostrar. CANCELADO/ESTORNADO ficam
 * fora: não são receita esperada nem realizada.
 */
export async function listReceivablesByDueRange(
  tenantId: string,
  from: string,
  to: string,
): Promise<Receivable[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `${SELECT}
        WHERE r.due_date >= $1::date AND r.due_date <= $2::date
          AND r.status NOT IN ('CANCELADO', 'ESTORNADO')
        ORDER BY r.due_date ASC, r.installment ASC`,
      [from, to],
    );
    return rows.map(toReceivable);
  });
}

/**
 * Série mensal do fluxo de caixa, do mês mais antigo ao corrente.
 *
 * `generate_series` monta os meses primeiro e as somas entram por subconsulta:
 * mês sem movimento vira barra zerada em vez de sumir do gráfico — um buraco
 * esconderia justamente o mês ruim. As duas somas usam datas diferentes de
 * propósito: recebimento é pela data da baixa (`paid_at`, o caixa) e previsto é
 * pelo vencimento (`due_date`, a competência). CANCELADO/ESTORNADO não são
 * expectativa de caixa e ficam fora.
 */
export async function cashFlowSeries(
  tenantId: string,
  months: number,
): Promise<CashFlowPoint[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      month: string;
      received: string;
      expected: string;
    }>(
      `
      WITH meses AS (
        SELECT generate_series(
                 date_trunc('month', CURRENT_DATE) - ($1::int - 1) * interval '1 month',
                 date_trunc('month', CURRENT_DATE),
                 interval '1 month'
               ) AS mes
      )
      SELECT to_char(m.mes, 'YYYY-MM') AS month,
             COALESCE((
               SELECT sum(COALESCE(r.paid_amount_cents, r.amount_cents))
                 FROM receivables r
                WHERE r.status = 'PAGO'
                  AND r.paid_at >= m.mes
                  AND r.paid_at <  m.mes + interval '1 month'
             ), 0) AS received,
             COALESCE((
               SELECT sum(r.amount_cents)
                 FROM receivables r
                WHERE r.status NOT IN ('CANCELADO', 'ESTORNADO')
                  AND r.due_date >= m.mes
                  AND r.due_date <  m.mes + interval '1 month'
             ), 0) AS expected
        FROM meses m
       ORDER BY m.mes
      `,
      [months],
    );

    return rows.map((row) => ({
      month: row.month,
      receivedCents: Number(row.received),
      expectedCents: Number(row.expected),
    }));
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

/**
 * Grava em lote a cobrança de condomínio de um período (uma conta por imóvel).
 *
 * `ON CONFLICT DO NOTHING` cai no índice parcial `idx_receivables_condo_charge`
 * (imóvel + competência). Retorna quantas foram criadas; a diferença para
 * `rows.length` é o que já existia.
 *
 * A conta NÃO leva `contract_id`, mesmo quando o pagador é o locatário: isto é
 * cobrança do condomínio, não parcela do contrato. Amarrá-la ao contrato a
 * colocaria nas listagens por contrato e a faria ser cancelada junto na
 * rescisão (`cancelOpenByContract`) — e ainda a sujeitaria ao índice
 * `idx_receivables_competence`, que não abre exceção para cobrança cancelada.
 */
export async function insertCondoCharges(
  tenantId: string,
  condominiumId: string,
  rows: CondoChargeRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `INSERT INTO receivables
         (tenant_id, condominium_id, property_id, payer_person_id,
          kind, description, competence, amount_cents, due_date)
       SELECT $1, $2, r.property_id, r.payer_person_id,
              'CONDOMINIO', r.description, r.competence, r.amount_cents, r.due_date::date
         FROM jsonb_to_recordset($3::jsonb) AS r(
              property_id     uuid,
              payer_person_id uuid,
              description     text,
              competence      text,
              amount_cents    bigint,
              due_date        text)
       ON CONFLICT DO NOTHING`,
      [
        tenantId,
        condominiumId,
        // As chaves do JSON precisam bater com as colunas de jsonb_to_recordset.
        JSON.stringify(
          rows.map((r) => ({
            property_id: r.propertyId,
            payer_person_id: r.payerPersonId,
            description: r.description,
            competence: r.competence,
            amount_cents: r.amountCents,
            due_date: r.dueDate,
          })),
        ),
      ],
    );
    return rowCount ?? 0;
  });
}

/**
 * Imóveis que já têm cobrança de condomínio na competência. Alimenta o
 * `alreadyBilled` da prévia — o usuário vê o que será pulado ANTES de gerar,
 * em vez de descobrir pelo contador no fim.
 */
/**
 * Todas as cobranças de condomínio emitidas por um condomínio, da mais recente
 * para a mais antiga. Alimenta a coluna de cobrança da lista de condôminos —
 * ordenada assim, a primeira de cada imóvel é a do último período gerado.
 */
export async function listCondoChargesByCondominium(
  tenantId: string,
  condominiumId: string,
): Promise<Receivable[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `${SELECT}
        WHERE r.condominium_id = $1
        ORDER BY r.due_date DESC, r.created_at DESC`,
      [condominiumId],
    );
    return rows.map(toReceivable);
  });
}

/**
 * Quanto cada condomínio já RECEBEU: soma do que foi efetivamente pago nas
 * cobranças de condomínio. É a entrada do saldo do condomínio.
 *
 * Soma `paid_amount_cents` (o que caiu) e não `amount_cents` (o que foi
 * cobrado): pagamento com juros e multa entra pelo valor real, e cobrança em
 * aberto não entra nenhum centavo.
 */
export async function sumPaidByCondominium(
  tenantId: string,
  condominiumIds: string[],
): Promise<Map<string, number>> {
  if (condominiumIds.length === 0) return new Map();
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ condominium_id: string; total: string }>(
      `SELECT condominium_id, COALESCE(SUM(paid_amount_cents), 0)::text AS total
         FROM receivables
        WHERE condominium_id = ANY($1::uuid[])
          AND kind = 'CONDOMINIO'
          AND status = 'PAGO'
        GROUP BY condominium_id`,
      [condominiumIds],
    );
    return new Map(rows.map((r) => [r.condominium_id, Number(r.total)]));
  });
}

export async function listCondoBilledPropertyIds(
  tenantId: string,
  competence: string,
  propertyIds: string[],
): Promise<string[]> {
  if (propertyIds.length === 0) return [];
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ property_id: string }>(
      `SELECT DISTINCT property_id FROM receivables
        WHERE kind = 'CONDOMINIO'
          AND competence = $1
          AND property_id = ANY($2::uuid[])
          AND status <> 'CANCELADO'`,
      [competence, propertyIds],
    );
    return rows.map((r) => r.property_id);
  });
}

export async function updateReceivable(
  tenantId: string,
  id: string,
  input: PatchReceivableInput,
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
