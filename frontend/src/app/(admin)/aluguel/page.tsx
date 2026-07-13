import { PageHeader, StatCard, Section, StatusBadge, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { formatPrice } from "../../../lib/api";

const cycles = [
  { comp: "2026-07", prop: "Studio Pinheiros", tenant: "Família Ribeiro", value: 320000, status: "paid" },
  { comp: "2026-07", prop: "Sala Faria Lima", tenant: "Sérgio Braga", value: 850000, status: "pending" },
  { comp: "2026-07", prop: "Apto Moema", tenant: "L. Fernandes", value: 480000, status: "overdue" },
  { comp: "2026-07", prop: "Casa Bertioga", tenant: "Turística Ltda", value: 450000, status: "paid" },
];

export default function AluguelPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operação · Módulo 7.10"
        title="Gestão de Aluguel"
        lead="Ciclos mensais, reajuste anual (IPCA padrão · IGP-M opcional), inadimplência com régua automatizada e vistorias de entrada/saída."
        actions={<button className="btn btn-primary btn-sm"><Icon name="key" /> Gerar Cobranças do Mês</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="key" label="Contratos ativos" value="312" tone="blue" />
        <StatCard icon="wallet" label="A receber (jul)" value="R$ 486k" tone="accent" />
        <StatCard icon="trendingDown" label="Inadimplência" value="3,4%" trendDir="down" trend="-0,6pp" tone="success" />
        <StatCard icon="calendar" label="Reajustes no mês" value="14" tone="warning" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <Section title="Ciclos de locação · competência 07/2026" action={<BackendNote endpoint="/v1/rental-cycles" />}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Imóvel</th><th>Inquilino</th><th>Valor</th><th>Status</th></tr></thead>
              <tbody>
                {cycles.map((c, i) => (
                  <tr key={i}>
                    <td className="strong">{c.prop}</td>
                    <td className="text-sm">{c.tenant}</td>
                    <td className="strong">{formatPrice(c.value)}</td>
                    <td><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Régua de inadimplência" pad>
          <p className="text-sm subtle mb-4">Sequência automática de alertas ao vencer (WhatsApp &gt; e-mail &gt; in-app).</p>
          <div className="timeline">
            {[
              { d: "D+1", t: "Lembrete amigável", done: true },
              { d: "D+3", t: "Aviso de atraso", done: true },
              { d: "D+7", t: "Cobrança formal", done: false },
              { d: "D+15", t: "Notificação + juros", done: false },
              { d: "D+30", t: "Escalada jurídica", done: false },
            ].map((s, i) => (
              <div className="timeline-item" key={i}>
                <div className="row-between">
                  <span className="text-sm strong">{s.d} · {s.t}</span>
                  {s.done
                    ? <span className="badge badge-green"><Icon name="check" size={12} /> enviado</span>
                    : <span className="badge badge-slate">agendado</span>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
