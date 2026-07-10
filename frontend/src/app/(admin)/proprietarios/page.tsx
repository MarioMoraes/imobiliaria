import { PageHeader, StatCard, Section, StatusBadge, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { sampleOwners } from "../../../lib/sample";

export default function ProprietariosPage() {
  return (
    <>
      <PageHeader
        eyebrow="Cadastros · Módulo 7.2"
        title="Proprietários"
        lead="Dados, contas de repasse e documentos dos proprietários. Repasse liberado após compensação do pagamento do inquilino."
        actions={<button className="btn btn-primary btn-sm"><Icon name="plus" /> Novo proprietário</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="user" label="Proprietários ativos" value="86" tone="blue" />
        <StatCard icon="building" label="Imóveis administrados" value="128" tone="accent" />
        <StatCard icon="wallet" label="Repasses no mês" value="R$ 214k" tone="success" />
        <StatCard icon="shield" label="Sem conta de repasse" value="3" tone="warning" />
      </div>

      <Section title="Proprietários" action={<BackendNote endpoint="/v1/owners" />}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nome / Razão social</th><th>Tipo</th><th>Contato</th>
                <th>Imóveis</th><th>Conta repasse</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sampleOwners.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="cell-main">
                      <span className="avatar" style={{ width: 34, height: 34, fontSize: "0.72rem" }}>
                        {o.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="strong">{o.name}</span>
                    </div>
                  </td>
                  <td><span className="badge badge-slate">{o.doc}</span></td>
                  <td className="text-sm subtle">{o.email}</td>
                  <td className="strong">{o.props}</td>
                  <td>
                    {o.bank
                      ? <span className="badge badge-green"><Icon name="check" size={12} /> Cadastrada</span>
                      : <span className="badge badge-amber"><Icon name="x" size={12} /> Pendente</span>}
                  </td>
                  <td><StatusBadge status={o.status} /></td>
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
