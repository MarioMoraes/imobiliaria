import { PageHeader, StatCard, Section, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { sampleCustomers } from "../../../lib/sample";

const stageBadge: Record<string, string> = {
  LEAD: "badge-cyan",
  CLIENTE: "badge-blue",
  INQUILINO: "badge-green",
  COMPRADOR: "badge-green",
  INATIVO: "badge-slate",
};

export default function ClientesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Cadastros · Módulo 7.3"
        title="Clientes"
        lead="Jornada unificada lead → cliente → inquilino/comprador. O perfil de busca alimenta a recomendação por IA."
        actions={<button className="btn btn-primary btn-sm"><Icon name="plus" /> Novo cliente</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="target" label="Leads no mês" value="147" trend="+23%" tone="accent" />
        <StatCard icon="users" label="Clientes ativos" value="1.284" tone="blue" />
        <StatCard icon="trendingUp" label="Conversão lead→cliente" value="34%" trend="+5pp" tone="success" />
        <StatCard icon="bot" label="Qualificados por IA" value="62%" tone="blue" />
      </div>

      <Section title="Base de clientes" action={<BackendNote endpoint="/v1/customers" />}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Cliente</th><th>Estágio</th><th>Intenção</th><th>Orçamento</th><th>Origem</th><th>Corretor</th><th></th></tr>
            </thead>
            <tbody>
              {sampleCustomers.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="cell-main">
                      <span className="avatar" style={{ width: 34, height: 34, fontSize: "0.72rem" }}>
                        {c.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="strong">{c.name}</span>
                    </div>
                  </td>
                  <td><span className={`badge ${stageBadge[c.stage]}`}>{c.stage}</span></td>
                  <td>{c.intent}</td>
                  <td className="text-sm">{c.budget}</td>
                  <td className="text-sm subtle">{c.source}</td>
                  <td className="text-sm">{c.broker}</td>
                  <td><button className="icon-btn" style={{ width: 30, height: 30 }}><Icon name="ellipsis" size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
