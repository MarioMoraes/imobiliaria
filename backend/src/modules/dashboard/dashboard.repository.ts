import { withTenant } from "../../shared/db.js";
import type {
  ContractStats,
  FinanceStats,
  PersonStats,
  PropertyStats,
  ReceivableBrief,
} from "./dashboard.schema.js";

/**
 * Leitura agregada do painel. Este é o único repositório que consulta tabelas
 * de outros módulos, e faz isso de propósito: um painel com seis números viraria
 * seis chamadas + somas em JS se fosse montado pelos services de cada domínio.
 * A regra que continua valendo: aqui só entra SELECT agregado — nenhuma escrita,
 * nenhuma regra de negócio (essas ficam no módulo dono da entidade).
 *
 * Todo acesso passa por withTenant(), então o RLS continua sendo quem garante o
 * isolamento — o SQL abaixo não filtra tenant_id à mão.
 */

/** BIGINT/COUNT chegam como string no driver pg. */
const num = (v: string | number | null | undefined): number => Number(v ?? 0);

/** `DATE` volta como Date; a API entrega YYYY-MM-DD sem fuso. */
const day = (d: Date | string): string =>
  typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);

export async function propertyStats(tenantId: string): Promise<PropertyStats> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      total: string;
      available: string;
      reserved: string;
      rented: string;
      sold: string;
      recent: string;
    }>(`
      SELECT count(*)                                                   AS total,
             count(*) FILTER (WHERE status = 'available')               AS available,
             count(*) FILTER (WHERE status = 'reserved')                AS reserved,
             count(*) FILTER (WHERE status = 'rented')                  AS rented,
             count(*) FILTER (WHERE status = 'sold')                    AS sold,
             count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS recent
        FROM properties
       WHERE is_development = false
    `);
    const r = rows[0];
    return {
      total: num(r?.total),
      available: num(r?.available),
      reserved: num(r?.reserved),
      rented: num(r?.rented),
      sold: num(r?.sold),
      createdLast30Days: num(r?.recent),
    };
  });
}

export async function contractStats(tenantId: string): Promise<ContractStats> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      active: string;
      in_signature: string;
      draft: string;
      ending_soon: string;
    }>(`
      SELECT count(*) FILTER (WHERE status = 'VIGENTE')       AS active,
             count(*) FILTER (WHERE status = 'EM_ASSINATURA') AS in_signature,
             count(*) FILTER (WHERE status = 'RASCUNHO')      AS draft,
             count(*) FILTER (
               WHERE status = 'VIGENTE'
                 AND ends_at IS NOT NULL
                 AND ends_at BETWEEN CURRENT_DATE AND CURRENT_DATE + interval '90 days'
             )                                                AS ending_soon
        FROM contracts
    `);
    const r = rows[0];
    return {
      active: num(r?.active),
      inSignature: num(r?.in_signature),
      draft: num(r?.draft),
      endingSoon: num(r?.ending_soon),
    };
  });
}

export async function personStats(tenantId: string): Promise<PersonStats> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      landlords: string;
      tenants: string;
      guarantors: string;
    }>(`
      SELECT count(*) FILTER (WHERE 'LOCADOR'   = ANY(roles)) AS landlords,
             count(*) FILTER (WHERE 'LOCATARIO' = ANY(roles)) AS tenants,
             count(*) FILTER (WHERE 'FIADOR'    = ANY(roles)) AS guarantors
        FROM persons
       WHERE status = 'active'
    `);
    const r = rows[0];
    return {
      landlords: num(r?.landlords),
      tenants: num(r?.tenants),
      guarantors: num(r?.guarantors),
    };
  });
}

interface BriefRow {
  id: string;
  due_date: Date;
  amount_cents: string | number;
  status: string;
  kind: string;
  description: string | null;
  payer_name: string | null;
}

const toBrief = (row: BriefRow): ReceivableBrief => ({
  id: row.id,
  dueDate: day(row.due_date),
  amountCents: num(row.amount_cents),
  status: row.status,
  kind: row.kind,
  description: row.description,
  payerName: row.payer_name,
});

/**
 * Bloco financeiro em uma ida só ao banco por consulta. "Vencido" é derivado da
 * data (status ABERTO cujo vencimento já passou também conta), porque a virada
 * ABERTO→VENCIDO depende de uma rotina que pode não ter rodado ainda.
 */
export async function financeStats(
  tenantId: string,
  listLimit = 5,
): Promise<FinanceStats> {
  return withTenant(tenantId, async (client) => {
    const totals = await client.query<{
      received_month: string;
      open_month: string;
      overdue_cents: string;
      overdue_count: string;
    }>(`
      SELECT COALESCE(sum(COALESCE(paid_amount_cents, amount_cents)) FILTER (
               WHERE status = 'PAGO'
                 AND paid_at >= date_trunc('month', CURRENT_DATE)
                 AND paid_at <  date_trunc('month', CURRENT_DATE) + interval '1 month'
             ), 0) AS received_month,
             COALESCE(sum(amount_cents) FILTER (
               WHERE status IN ('ABERTO', 'VENCIDO')
                 AND due_date >= date_trunc('month', CURRENT_DATE)
                 AND due_date <  date_trunc('month', CURRENT_DATE) + interval '1 month'
             ), 0) AS open_month,
             COALESCE(sum(amount_cents) FILTER (
               WHERE status IN ('ABERTO', 'VENCIDO') AND due_date < CURRENT_DATE
             ), 0) AS overdue_cents,
             count(*) FILTER (
               WHERE status IN ('ABERTO', 'VENCIDO') AND due_date < CURRENT_DATE
             ) AS overdue_count
        FROM receivables
    `);

    const briefCols = `
      r.id, r.due_date, r.amount_cents, r.status, r.kind, r.description,
      p.full_name AS payer_name
        FROM receivables r
        LEFT JOIN persons p ON p.id = r.payer_person_id`;

    // "Vencimentos do mês" espelha a lista de contas a receber do Financeiro,
    // recortada nos aluguéis: mesma regra de mês (a competência da parcela, ou o
    // mês do vencimento quando ela é avulsa) e mesma ausência de filtro de
    // status — se as duas telas usassem critérios diferentes, uma parcela
    // apareceria em uma e sumiria na outra. O único filtro a mais é o
    // `kind = 'ALUGUEL'`: condomínio, multa e avulsas ficam para o Financeiro.
    const upcoming = await client.query<BriefRow>(
      `SELECT ${briefCols}
        WHERE r.kind = 'ALUGUEL'
          AND COALESCE(r.competence, to_char(r.due_date, 'YYYY-MM'))
              = to_char(CURRENT_DATE, 'YYYY-MM')
        ORDER BY r.due_date ASC
        LIMIT $1`,
      [listLimit],
    );

    const overdue = await client.query<BriefRow>(
      `SELECT ${briefCols}
        WHERE r.status IN ('ABERTO', 'VENCIDO') AND r.due_date < CURRENT_DATE
        ORDER BY r.due_date ASC
        LIMIT $1`,
      [listLimit],
    );

    const t = totals.rows[0];

    return {
      receivedThisMonthCents: num(t?.received_month),
      openThisMonthCents: num(t?.open_month),
      overdueCents: num(t?.overdue_cents),
      overdueCount: num(t?.overdue_count),
      upcoming: upcoming.rows.map(toBrief),
      overdue: overdue.rows.map(toBrief),
    };
  });
}
