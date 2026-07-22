import { PageHeader, StatCard, Section, StatusBadge } from "../../../../components/ui";
import { Icon } from "../../../../components/Icon";
import { fetchReceivables, formatDay, formatPrice, type Receivable } from "../../../../lib/api";
import { sampleTransfers } from "../../../../lib/sample";

const months = ["Fev", "Mar", "Abr", "Mai", "Jun", "Jul"];
const inflow = [62, 70, 66, 78, 82, 90];
const outflow = [40, 44, 43, 47, 49, 52];

/** Uma parcela em aberto cujo vencimento já passou aparece como vencida. */
function displayStatus(r: Receivable, today: string): string {
  return r.status === "ABERTO" && r.dueDate < today ? "VENCIDO" : r.status;
}

function describe(r: Receivable): string {
  if (r.description) return r.description;
  return r.kind === "ALUGUEL" ? "Aluguel" : r.kind;
}

export default async function GestaoFinanceiraPage() {
  const receivables = (await fetchReceivables()) ?? [];
  const today = new Date().toISOString().slice(0, 10);
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
          <Section title="Fluxo de caixa" action={<span className="badge badge-blue">6 meses</span>} pad>
            <div className="row gap-8 mb-4">
              <span className="badge badge-blue"><span className="dot" style={{ background: "var(--primary)" }} /> Entradas</span>
              <span className="badge badge-slate"><span className="dot" style={{ background: "var(--border-strong)" }} /> Saídas</span>
            </div>
            <div className="chart">
              {inflow.map((v, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ width: "100%", display: "flex", gap: 3, alignItems: "flex-end", height: 140 }}>
                    <div className="chart-bar" style={{ height: `${v}%` }} />
                    <div className="chart-bar muted" style={{ height: `${outflow[i]}%` }} />
                  </div>
                  <span className="text-xs subtle">{months[i]}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Contas a receber">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Descrição</th><th>Pagador</th><th>Competência</th><th>Venc.</th><th>Valor</th><th>Status</th></tr></thead>
                <tbody>
                  {receivables.map((r) => (
                    <tr key={r.id}>
                      <td className="strong">{describe(r)}</td>
                      <td className="text-sm">{r.payerName ?? "—"}</td>
                      <td className="text-sm subtle">{r.competence ?? "—"}</td>
                      <td className="text-sm subtle">{formatDay(r.dueDate)}</td>
                      <td className="strong">{formatPrice(r.amountCents)}</td>
                      <td><StatusBadge status={displayStatus(r, today)} /></td>
                    </tr>
                  ))}
                  {receivables.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-sm subtle">
                        Nenhuma cobrança ainda. Os aluguéis são gerados quando o contrato é
                        assinado por todas as partes.
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
