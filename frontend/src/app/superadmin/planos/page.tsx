import { PageHeader, StatCard, Section, StatusBadge } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { samplePlans } from "../../../lib/sample";

const invoices = [
  { tenant: "Vera Cruz Imóveis", plan: "Enterprise", value: "R$ 2.400", status: "paid", due: "05 jul" },
  { tenant: "Imobiliária Demo", plan: "Pro", value: "R$ 449", status: "paid", due: "05 jul" },
  { tenant: "Alpha Negócios", plan: "Starter", value: "R$ 149", status: "overdue", due: "28 jun" },
  { tenant: "Litoral Sul", plan: "Pro", value: "R$ 449", status: "pending", due: "10 jul" },
];

export default function PlanosPage() {
  return (
    <>
      <PageHeader
        title="Planos & Billing"
        actions={<button className="btn btn-primary btn-sm"><Icon name="plus" /> Novo Plano</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="wallet" label="MRR" value="R$ 128,4k" trend="+8,1%" feature />
        <StatCard icon="receipt" label="Faturas em aberto" value="R$ 12,3k" tone="warning" />
        <StatCard icon="building" label="Assinaturas ativas" value="169" tone="blue" />
        <StatCard icon="trendingDown" label="Inadimplência" value="2,1%" trendDir="down" tone="success" />
      </div>

      <div className="grid grid-3 mb-4">
        {samplePlans.map((p) => (
          <div className="card card-pad card-hover" key={p.name}>
            <div className="eyebrow">{p.name}</div>
            <div className="num" style={{ fontSize: "1.6rem", margin: "8px 0" }}>{p.price}</div>
            <div className="stack" style={{ gap: 8, margin: "12px 0" }}>
              <span className="row gap-8 text-sm"><Icon name="building" size={15} /> {p.props} imóveis</span>
              <span className="row gap-8 text-sm"><Icon name="bot" size={15} /> {p.agents}</span>
            </div>
            <div className="divider" style={{ margin: "12px 0" }} />
            <div className="row-between">
              <span className="text-sm subtle">{p.tenants} tenants</span>
              <button className="btn btn-ghost btn-sm">Editar</button>
            </div>
          </div>
        ))}
      </div>

      <Section title="Faturas da plataforma">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Tenant</th><th>Plano</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead>
            <tbody>
              {invoices.map((iv, i) => (
                <tr key={i}>
                  <td className="strong">{iv.tenant}</td>
                  <td><span className="badge badge-slate">{iv.plan}</span></td>
                  <td className="strong">{iv.value}</td>
                  <td className="text-sm subtle">{iv.due}</td>
                  <td><StatusBadge status={iv.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
