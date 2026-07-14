import { PageHeader, StatCard, Section } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { sampleBrokers } from "../../../lib/sample";
import { formatPrice } from "../../../lib/api";

export default function CorretoresPage() {
  const ranked = [...sampleBrokers].sort((a, b) => b.commission - a.commission);

  return (
    <>
      <PageHeader
        title="Corretores"
        actions={<button className="btn btn-primary btn-sm"><Icon name="plus" /> Novo Corretor</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="broker" label="Corretores ativos" value="24" tone="blue" />
        <StatCard icon="target" label="Leads atribuídos (mês)" value="147" tone="accent" />
        <StatCard icon="contract" label="Negócios fechados" value="63" trend="+11" tone="success" />
        <StatCard icon="wallet" label="Comissões a pagar" value="R$ 176k" tone="warning" />
      </div>

      <Section title="Ranking · comissão acumulada no mês">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>#</th><th>Corretor</th><th>CRECI</th><th>Equipe</th><th>Negócios</th><th>Conversão</th><th>Comissão</th></tr>
            </thead>
            <tbody>
              {ranked.map((b, i) => (
                <tr key={b.id}>
                  <td><span className="num" style={{ color: i === 0 ? "var(--primary)" : "var(--muted)" }}>{i + 1}º</span></td>
                  <td>
                    <div className="cell-main">
                      <span className="avatar" style={{ width: 34, height: 34, fontSize: "0.72rem" }}>{b.avatar}</span>
                      <span className="strong">{b.name}</span>
                    </div>
                  </td>
                  <td className="text-xs subtle">{b.creci}</td>
                  <td className="text-sm">{b.team}</td>
                  <td className="strong">{b.deals}</td>
                  <td>
                    <div className="row gap-8">
                      <div className="bar" style={{ width: 60 }}><span style={{ width: `${b.conv * 2}%` }} /></div>
                      <span className="text-xs strong">{b.conv}%</span>
                    </div>
                  </td>
                  <td className="strong">{formatPrice(b.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
