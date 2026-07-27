import { PageHeader, StatCard, Section, StatusBadge } from "../../../../components/ui";
import { CashFlowChart } from "../../../../components/CashFlowChart";
import { Icon } from "../../../../components/Icon";
import {
  fetchCashFlow,
  fetchReceivables,
  formatDay,
  formatPrice,
  type Receivable,
} from "../../../../lib/api";
import { sampleTransfers } from "../../../../lib/sample";

/** Janela do gráfico: 6 meses para trás, incluindo o corrente. */
const CASH_FLOW_MONTHS = 6;

const monthNames = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-07" → "julho/2026". */
function monthTitle(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return `${monthNames[index] ?? month}/${month.slice(0, 4)}`;
}

/** Uma parcela em aberto cujo vencimento já passou aparece como vencida. */
function displayStatus(r: Receivable, today: string): string {
  return r.status === "ABERTO" && r.dueDate < today ? "VENCIDO" : r.status;
}

function describe(r: Receivable): string {
  if (r.description) return r.description;
  return r.kind === "ALUGUEL" ? "Aluguel" : r.kind;
}

export default async function GestaoFinanceiraPage() {
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);

  // Duas listas de propósito: os indicadores olham a carteira inteira (o "a
  // receber" e a inadimplência não são do mês), enquanto a tabela de contas a
  // receber mostra só a competência corrente — pedir o mês ao backend em vez de
  // filtrar aqui evita que o limite da listagem corte justamente essas parcelas.
  const [receivables, monthReceivables, cashFlow] = await Promise.all([
    fetchReceivables().then((r) => r ?? []),
    fetchReceivables({ competence: currentMonth }).then((r) => r ?? []),
    fetchCashFlow(CASH_FLOW_MONTHS).then((c) => c ?? []),
  ]);
  const sum = (list: Receivable[]) => list.reduce((acc, r) => acc + r.amountCents, 0);

  const abertos = receivables.filter((r) => r.status === "ABERTO");
  const recebido = receivables.filter((r) => r.status === "PAGO");
  const vencidos = abertos.filter((r) => r.dueDate < today);
  const aVencer = sum(abertos);
  const inadimplencia = aVencer > 0 ? (sum(vencidos) / aVencer) * 100 : 0;

  return (
    <>
      <PageHeader
        title="Gestão Financeira"
        backHref="/financeiro"
        actions={
          <>
            <button className="btn btn-outline btn-sm"><Icon name="receipt" /> Exportar</button>
            <button className="btn btn-primary btn-sm"><Icon name="plus" /> Nova Cobrança</button>
          </>
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="wallet" label="Recebido" value={formatPrice(sum(recebido))} feature />
        <StatCard icon="banknote" label="A receber" value={formatPrice(aVencer)} tone="accent" />
        <StatCard
          icon="trendingDown"
          label="Inadimplência"
          value={`${inadimplencia.toFixed(1).replace(".", ",")}%`}
          tone={inadimplencia > 0 ? "warning" : "success"}
        />
        <StatCard icon="receipt" label="Repasses pendentes" value="R$ 7,6k" tone="warning" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <div className="stack">
          <Section
            title="Recebido X Previsto"
            action={<span className="badge badge-blue">{CASH_FLOW_MONTHS} meses</span>}
            pad
          >
            <CashFlowChart points={cashFlow} />
          </Section>

          <Section
            title="Contas a receber"
            action={<span className="badge badge-blue">{monthTitle(currentMonth)}</span>}
          >
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Descrição</th><th>Pagador</th><th>Competência</th><th>Venc.</th><th>Valor</th><th>Status</th></tr></thead>
                <tbody>
                  {monthReceivables.map((r) => (
                    <tr key={r.id}>
                      <td className="strong">{describe(r)}</td>
                      <td className="text-sm">{r.payerName ?? "—"}</td>
                      <td className="text-sm subtle">{r.competence ?? "—"}</td>
                      <td className="text-sm subtle">{formatDay(r.dueDate)}</td>
                      <td className="strong">{formatPrice(r.amountCents)}</td>
                      <td><StatusBadge status={displayStatus(r, today)} /></td>
                    </tr>
                  ))}
                  {monthReceivables.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-sm subtle">
                        {receivables.length === 0
                          ? "Nenhuma cobrança ainda. Os aluguéis são gerados quando o contrato é assinado por todas as partes."
                          : `Nenhuma cobrança com competência em ${monthTitle(currentMonth)}.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        <div className="stack">
          <Section title="DRE simplificado · julho" pad>
            <div className="stack" style={{ gap: 12 }}>
              {[
                ["Receita bruta", "R$ 92.400", false],
                ["(−) Descontos", "R$ 1.200", false],
                ["(−) Inadimplência", "R$ 4.800", false],
                ["Receita líquida", "R$ 86.400", true],
                ["(−) Custos fixos", "R$ 38.900", false],
                ["Resultado", "R$ 47.500", true],
              ].map(([k, v, strong], i) => (
                <div key={i} className="row-between" style={{ paddingBottom: 8, borderBottom: i < 5 ? "1px solid var(--border)" : "none" }}>
                  <span className={strong ? "strong" : "subtle text-sm"}>{k}</span>
                  <span className={strong ? "num gradient-text" : "strong text-sm"} style={strong ? { fontSize: "1.05rem" } : undefined}>{v}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Repasses a proprietários">
            <div className="card-pad stack" style={{ gap: 12 }}>
              {sampleTransfers.map((t, i) => (
                <div key={i} className="card card-pad" style={{ padding: 14 }}>
                  <div className="row-between mb-2">
                    <span className="strong text-sm">{t.owner}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="text-xs subtle" style={{ marginBottom: 8 }}>{t.prop}</div>
                  <div className="row-between text-xs">
                    <span className="subtle">Bruto {formatPrice(t.gross)} · taxa {formatPrice(t.fee)}</span>
                    <span className="strong num">{formatPrice(t.net)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
