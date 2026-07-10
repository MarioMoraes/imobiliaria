import { PageHeader, StatCard, Section, StatusBadge, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { formatPrice } from "../../../lib/api";
import { sampleReceivables, sampleTransfers } from "../../../lib/sample";

const months = ["Fev", "Mar", "Abr", "Mai", "Jun", "Jul"];
const inflow = [62, 70, 66, 78, 82, 90];
const outflow = [40, 44, 43, 47, 49, 52];

export default function FinanceiroPage() {
  return (
    <>
      <PageHeader
        eyebrow="Financeiro · Módulo 7.9"
        title="Gestão Financeira"
        lead="Contas a receber/pagar, cobrança via Asaas, repasse ao proprietário (após compensação), comissões e DRE simplificado."
        actions={
          <>
            <button className="btn btn-outline btn-sm"><Icon name="receipt" /> Exportar</button>
            <button className="btn btn-primary btn-sm"><Icon name="plus" /> Nova cobrança</button>
          </>
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="wallet" label="Recebido (jul)" value="R$ 86,4k" trend="+10%" feature />
        <StatCard icon="banknote" label="A receber" value="R$ 52,3k" tone="accent" />
        <StatCard icon="trendingDown" label="Inadimplência" value="3,4%" trendDir="down" trend="-0,6pp" tone="success" />
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

          <Section title="Contas a receber" action={<BackendNote endpoint="/v1/receivables" />}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Descrição</th><th>Pagador</th><th>Venc.</th><th>Valor</th><th>Status</th></tr></thead>
                <tbody>
                  {sampleReceivables.map((r) => (
                    <tr key={r.id}>
                      <td className="strong">{r.desc}</td>
                      <td className="text-sm">{r.party}</td>
                      <td className="text-sm subtle">{r.due}</td>
                      <td className="strong">{formatPrice(r.value)}</td>
                      <td><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
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

          <Section title="Repasses a proprietários" action={<BackendNote endpoint="/v1/transfers" />}>
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
