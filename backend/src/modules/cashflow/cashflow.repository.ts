import pg from "pg";
import { withTenant } from "../../shared/db.js";
import { addMonths, isoDay, parseIsoDay } from "../../shared/month.js";
import type {
  CashFlowByCategory,
  CashFlowDirection,
  CashFlowMovement,
  CashFlowSeriesPoint,
  CashFlowSource,
} from "./cashflow.schema.js";

/**
 * Leitura do fluxo de caixa.
 *
 * **Exceção de fronteira autorizada:** este repositório faz SELECT direto em
 * `receivables`, `payables`, `commissions` e `condominium_expenses` — tabelas de
 * outros módulos. É a mesma licença dada ao módulo `dashboard`, e pelo mesmo
 * motivo: um read model que consolida N domínios não cabe atrás dos services sem
 * transformar uma tela em N+1 chamadas.
 *
 * O que ele NÃO faz é copiar. O movimento automático é derivado na hora, nunca
 * gravado: `init.sql` já decidiu que a taxa de administração vive em
 * `payables.admin_fee_cents` e não vira linha própria, justamente para cancelar
 * um repasse apagar a taxa junto. Um ledger paralelo desfaria isso.
 */

interface MovementRow {
  key: string;
  date: string; // DATE -> string (ver setTypeParser em shared/db.ts)
  source: string;
  direction: string;
  ref: string | null;
  description: string | null;
  amount_cents: string | number;
  affects_cash: boolean;
  affects_result: boolean;
  category_id: string | null;
  category_name: string | null;
  source_id: string | null;
}

/**
 * As sete origens do extrato, em um UNION ALL. Cada ramo declara as duas flags
 * — ver o cabeçalho de `cashflow.schema.ts` para o porquê de a taxa de
 * administração entrar no resultado e não no caixa.
 *
 * A janela `[$1, $2)` é meio-aberta e vem pronta de fora: a mesma consulta serve
 * ao extrato de um mês e à série de vários, e assim as duas visões não podem
 * divergir — mudou a regra de uma origem, mudou nas duas.
 */
const MOVEMENTS_SQL = `
  -- 1. Recebimento do inquilino: entra no banco INTEIRO, inclusive a parte que
  --    será repassada. É dinheiro de terceiros, então não é resultado.
  SELECT 'RECEBIMENTO:' || r.id                      AS key,
         r.paid_at                                   AS date,
         'RECEBIMENTO'                               AS source,
         'ENTRADA'                                   AS direction,
         r.kind                                      AS ref,
         NULLIF(concat_ws(' · ', ps.full_name, r.competence), '') AS description,
         COALESCE(r.paid_amount_cents, r.amount_cents)::bigint    AS amount_cents,
         true                                        AS affects_cash,
         false                                       AS affects_result,
         NULL::uuid                                  AS category_id,
         NULL::text                                  AS category_name,
         r.id                                        AS source_id
    FROM receivables r
    LEFT JOIN persons ps ON ps.id = r.payer_person_id
   WHERE r.status = 'PAGO'
     AND r.paid_at >= $1::date AND r.paid_at < $2::date

  UNION ALL

  -- 2. Taxa de administração: NÃO é caixa (já veio dentro do aluguel acima),
  --    mas é a receita da imobiliária. A data é a da baixa do aluguel — o fato
  --    gerador é o pagamento da parcela, não o vencimento do repasse.
  SELECT 'TAXA_ADM:' || p.id,
         r.paid_at,
         'TAXA_ADM',
         'ENTRADA',
         NULL,
         NULLIF(concat_ws(' · ',
           CASE WHEN pr.code IS NOT NULL THEN 'Imóvel ' || pr.code END,
           p.competence), ''),
         p.admin_fee_cents::bigint,
         false,
         true,
         NULL::uuid,
         NULL::text,
         p.id
    FROM payables p
    JOIN receivables r      ON r.id  = p.receivable_id
    LEFT JOIN properties pr ON pr.id = p.property_id
   WHERE p.status NOT IN ('CANCELADO', 'ESTORNADO')
     AND p.admin_fee_cents > 0
     AND r.status = 'PAGO'
     AND r.paid_at >= $1::date AND r.paid_at < $2::date

  UNION ALL

  -- 3. Juros e multa: o inquilino atrasado paga mais que a parcela, e o repasse
  --    é calculado sobre a PARCELA (ver payable/owner-payout.ts). A sobra fica
  --    com a imobiliária — é receita, e sem esta linha o resultado não fecharia
  --    com o dinheiro retido do aluguel.
  SELECT 'JUROS_MULTA:' || r.id,
         r.paid_at,
         'JUROS_MULTA',
         'ENTRADA',
         r.kind,
         NULLIF(concat_ws(' · ', ps.full_name, r.competence), ''),
         (r.paid_amount_cents - r.amount_cents)::bigint,
         false,
         true,
         NULL::uuid,
         NULL::text,
         r.id
    FROM receivables r
    LEFT JOIN persons ps ON ps.id = r.payer_person_id
   WHERE r.status = 'PAGO'
     AND r.paid_at >= $1::date AND r.paid_at < $2::date
     AND r.paid_amount_cents > r.amount_cents

  UNION ALL

  -- 4. Repasse ao proprietário: sai do banco, mas não é despesa da imobiliária
  --    — é a devolução do dinheiro de terceiro que entrou em (1).
  SELECT 'REPASSE:' || p.id,
         p.paid_at,
         'REPASSE',
         'SAIDA',
         NULL,
         NULLIF(concat_ws(' · ', ps.full_name, p.competence), ''),
         COALESCE(p.paid_amount_cents, p.amount_cents)::bigint,
         true,
         false,
         NULL::uuid,
         NULL::text,
         p.id
    FROM payables p
    LEFT JOIN persons ps ON ps.id = p.payee_person_id
   WHERE p.status = 'PAGO'
     AND p.paid_at >= $1::date AND p.paid_at < $2::date

  UNION ALL

  -- 5. Despesa do condomínio: paga com o que os condôminos recolheram em (1), e
  --    portanto o OUTRO LADO daquela entrada — exatamente o papel que (4) tem
  --    para o aluguel. Sai do banco e não é despesa nossa.
  --
  --    Sem este ramo o caixa inflava para sempre pelo total arrecadado: a cota
  --    entrava e nada saía. O saldo do condomínio (arrecadado − gasto) é o que
  --    fica retido, e pendingPayouts() abaixo o soma ao repasse em aberto.
  --
  --    entry_date é anulável no cadastro; a janela já descarta esses nulos, e é
  --    o correto — um lançamento sem data não pertence a mês nenhum.
  SELECT 'DESPESA_CONDOMINIO:' || x.id,
         x.entry_date,
         'DESPESA_CONDOMINIO',
         'SAIDA',
         NULL,
         NULLIF(concat_ws(' · ', cd.name, ev.name, x.notes), ''),
         x.amount_cents::bigint,
         true,
         false,
         NULL::uuid,
         NULL::text,
         x.id
    FROM condominium_expenses x
    LEFT JOIN condominiums cd ON cd.id = x.condominium_id
    LEFT JOIN events ev       ON ev.id = x.event_id
   WHERE x.entry_date >= $1::date AND x.entry_date < $2::date

  UNION ALL

  -- 6. Comissões: dinheiro próprio dos dois lados — a da imobiliária entra, a do
  --    corretor sai. Conta no caixa E no resultado.
  SELECT 'COMISSAO:' || c.id,
         c.settled_at,
         'COMISSAO',
         CASE WHEN c.party = 'IMOBILIARIA' THEN 'ENTRADA' ELSE 'SAIDA' END,
         c.party,
         NULLIF(concat_ws(' · ', c.description, b.name), ''),
         COALESCE(c.settled_amount_cents, c.amount_cents)::bigint,
         true,
         true,
         NULL::uuid,
         NULL::text,
         c.id
    FROM commissions c
    LEFT JOIN brokers b ON b.id = c.broker_id
   WHERE c.status = 'QUITADO'
     AND c.settled_at >= $1::date AND c.settled_at < $2::date

  UNION ALL

  -- 7. Lançamento manual: despesa do escritório, receita avulsa.
  SELECT 'MANUAL:' || e.id,
         e.entry_date,
         'MANUAL',
         e.direction,
         NULL,
         e.description,
         e.amount_cents::bigint,
         true,
         true,
         e.category_id,
         cat.name,
         e.id
    FROM cash_flow_entries e
    LEFT JOIN cash_flow_categories cat ON cat.id = e.category_id
   WHERE e.entry_date >= $1::date AND e.entry_date < $2::date
`;

function toMovement(row: MovementRow): CashFlowMovement {
  return {
    key: row.key,
    date: row.date,
    source: row.source as CashFlowSource,
    direction: row.direction as CashFlowDirection,
    label: labelFor(row.source as CashFlowSource, row.ref),
    description: row.description,
    amountCents: Number(row.amount_cents),
    affectsCash: row.affects_cash,
    affectsResult: row.affects_result,
    categoryId: row.category_id,
    categoryName: row.category_name,
    sourceId: row.source_id,
  };
}

/**
 * Rótulo curto da natureza — em TS e não em CASE no SQL, para caber no i18n
 * depois.
 *
 * Capitalização de título (só as preposições em minúscula): estes rótulos são
 * o nome da coluna "Natureza" e viram nome de categoria no resumo, não frases.
 */
function labelFor(source: CashFlowSource, ref: string | null): string {
  switch (source) {
    case "RECEBIMENTO":
      return `${kindLabel(ref)} Recebido`;
    case "TAXA_ADM":
      return "Taxa de Administração";
    case "JUROS_MULTA":
      return "Juros e Multa de Atraso";
    case "REPASSE":
      return "Repasse ao Proprietário";
    case "DESPESA_CONDOMINIO":
      return "Despesa de Condomínio";
    case "COMISSAO":
      return ref === "CORRETOR" ? "Comissão de Corretor" : "Comissão de Venda";
    case "MANUAL":
      return "Lançamento Manual";
  }
}

function kindLabel(kind: string | null): string {
  switch (kind) {
    case "ALUGUEL":
      return "Aluguel";
    case "CONDOMINIO":
      return "Condomínio";
    case "IPTU":
      return "IPTU";
    case "MULTA":
      return "Multa";
    default:
      return "Valor";
  }
}

/**
 * Janela meio-aberta de um mês: `["YYYY-MM-01", primeiro dia do mês seguinte)`.
 * Calculada com os helpers de `shared/month.ts` para não passar por `Date` local
 * e escorregar um dia por fuso — mesma disciplina do resto das datas de negócio.
 */
function monthWindow(month: string): [string, string] {
  const [year, monthIndex] = parseIsoDay(`${month}-01`);
  const [nextYear, nextMonth] = addMonths(year, monthIndex, 1);
  return [isoDay(year, monthIndex, 1), isoDay(nextYear, nextMonth, 1)];
}

/**
 * Dinheiro de terceiros ainda retido, de QUALQUER mês. É o que explica o saldo
 * de caixa ser maior que o resultado, e por isso não é filtrado pela janela: um
 * aluguel recebido em julho e ainda não repassado em agosto continua sendo
 * dinheiro que não é nosso.
 *
 * São DUAS retenções, uma por tipo de terceiro:
 *
 * 1. **Proprietário** — repasses em aberto ou em trânsito.
 * 2. **Condomínio** — o arrecadado dos condôminos menos o já gasto. É o mesmo
 *    saldo derivado que `condominium.service` mostra na tela do condomínio, e
 *    calculá-lo aqui de novo é deliberado: uma chamada ao outro service por
 *    condomínio seria N+1 dentro de um read model que existe para evitar isso.
 *
 * A parcela do condomínio entra com sinal — ver o comentário de
 * `pendingPayoutCents` em `cashflow.schema.ts` para o porquê de não truncar.
 */
async function pendingPayouts(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query<{ total: string }>(
    `SELECT
       (SELECT COALESCE(sum(amount_cents), 0)
          FROM payables
         WHERE status IN ('ABERTO', 'VENCIDO', 'PROCESSANDO'))
     + (SELECT COALESCE(sum(paid_amount_cents), 0)
          FROM receivables
         WHERE kind = 'CONDOMINIO' AND status = 'PAGO')
     - (SELECT COALESCE(sum(amount_cents), 0)
          FROM condominium_expenses) AS total`,
  );
  return Number(rows[0]?.total ?? 0);
}

export interface StatementData {
  movements: CashFlowMovement[];
  pendingPayoutCents: number;
}

/** Extrato do mês + o retido de terceiros, numa transação só. */
export async function statementData(
  tenantId: string,
  month: string,
): Promise<StatementData> {
  const [start, end] = monthWindow(month);
  return windowData(tenantId, start, end);
}

/**
 * O mesmo extrato sobre uma janela livre `[start, end)` — a base dos relatórios
 * de período.
 *
 * Compartilha o `MOVEMENTS_SQL` com o extrato do mês e com a série de propósito:
 * as três visões respondem à mesma pergunta em recortes diferentes, e uma
 * consulta própria para o relatório significaria descobrir a divergência só
 * quando alguém comparasse o PDF com a tela.
 */
export async function windowData(
  tenantId: string,
  start: string,
  end: string,
): Promise<StatementData> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<MovementRow>(
      `${MOVEMENTS_SQL} ORDER BY date ASC, source ASC`,
      [start, end],
    );
    return {
      movements: rows.map(toMovement),
      pendingPayoutCents: await pendingPayouts(client),
    };
  });
}

/**
 * Série mensal (o gráfico), do mês mais antigo ao corrente.
 *
 * Reusa o MESMO `MOVEMENTS_SQL` do extrato, agora sobre a janela inteira e
 * agrupado por mês. Mês sem movimento vira ponto zerado em vez de sumir do
 * gráfico — um buraco esconderia justamente o mês ruim (mesma escolha de
 * `cashFlowSeries` em `receivable.repository.ts`).
 */
export async function series(
  tenantId: string,
  months: number,
): Promise<CashFlowSeriesPoint[]> {
  const today = new Date();
  const [endYear, endMonth] = addMonths(today.getUTCFullYear(), today.getUTCMonth(), 1);
  const [startYear, startMonth] = addMonths(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    -(months - 1),
  );
  const start = isoDay(startYear, startMonth, 1);
  const end = isoDay(endYear, endMonth, 1);

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      month: string;
      cash_in: string;
      cash_out: string;
      result_in: string;
      result_out: string;
    }>(
      `
      WITH meses AS (
        SELECT generate_series($1::date, $2::date - interval '1 day', interval '1 month')::date AS ini
      ),
      mov AS (${MOVEMENTS_SQL})
      SELECT to_char(m.ini, 'YYYY-MM') AS month,
             COALESCE(sum(mov.amount_cents) FILTER (
               WHERE mov.affects_cash   AND mov.direction = 'ENTRADA'), 0) AS cash_in,
             COALESCE(sum(mov.amount_cents) FILTER (
               WHERE mov.affects_cash   AND mov.direction = 'SAIDA'),   0) AS cash_out,
             COALESCE(sum(mov.amount_cents) FILTER (
               WHERE mov.affects_result AND mov.direction = 'ENTRADA'), 0) AS result_in,
             COALESCE(sum(mov.amount_cents) FILTER (
               WHERE mov.affects_result AND mov.direction = 'SAIDA'),   0) AS result_out
        FROM meses m
        LEFT JOIN mov ON date_trunc('month', mov.date) = m.ini
       GROUP BY m.ini
       ORDER BY m.ini
      `,
      [start, end],
    );

    return rows.map((row) => {
      const cashInCents = Number(row.cash_in);
      const cashOutCents = Number(row.cash_out);
      return {
        month: row.month,
        cashInCents,
        cashOutCents,
        cashNetCents: cashInCents - cashOutCents,
        resultNetCents: Number(row.result_in) - Number(row.result_out),
      };
    });
  });
}

/**
 * Resumo por categoria. Agrupa o RESULTADO, não o caixa: "quanto gastei com
 * salários" e "quanto ganhei de taxa" são perguntas de resultado — aluguel
 * recebido e repasse pago são a mesma passagem de dinheiro e só poluiriam a
 * leitura. Lançamento manual agrupa pela categoria; origem automática, pelo
 * próprio rótulo, que é o que quem lê a tela chama de categoria.
 */
export function groupByCategory(movements: CashFlowMovement[]): CashFlowByCategory[] {
  const groups = new Map<string, CashFlowByCategory>();

  for (const m of movements) {
    if (!m.affectsResult) continue;

    const name = m.source === "MANUAL" ? (m.categoryName ?? "Sem Categoria") : m.label;
    const key = `${m.direction}:${name}`;
    const current = groups.get(key);
    if (current) {
      current.amountCents += m.amountCents;
    } else {
      groups.set(key, {
        categoryId: m.source === "MANUAL" ? m.categoryId : null,
        categoryName: name,
        direction: m.direction,
        amountCents: m.amountCents,
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.amountCents - a.amountCents);
}
