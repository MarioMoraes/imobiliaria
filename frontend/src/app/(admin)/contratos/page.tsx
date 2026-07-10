import { PageHeader, StatCard, Section, StatusBadge, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { sampleContracts } from "../../../lib/sample";

export default function ContratosPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operação · Módulo 7.8"
        title="Contratos"
        lead="Locação, venda e intermediação. Templates com cláusulas dinâmicas, geração de PDF e renovação automática (opt-out). Reajuste padrão IPCA."
        actions={
          <>
            <button className="btn btn-outline btn-sm"><Icon name="contract" /> Templates</button>
            <button className="btn btn-primary btn-sm"><Icon name="plus" /> Novo contrato</button>
          </>
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="check" label="Vigentes" value="312" tone="success" />
        <StatCard icon="clock" label="Em assinatura" value="7" tone="accent" />
        <StatCard icon="calendar" label="Renovam em 30 dias" value="18" tone="warning" />
        <StatCard icon="contract" label="Assinados no mês" value="24" trend="+4" tone="blue" />
      </div>

      <Section title="Contratos" action={<BackendNote endpoint="/v1/contracts" />}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Contrato</th><th>Tipo</th><th>Parte</th><th>Imóvel</th><th>Valor</th><th>Status</th><th>Vigência</th><th></th></tr>
            </thead>
            <tbody>
              {sampleContracts.map((c) => (
                <tr key={c.id}>
                  <td className="strong">{c.id}</td>
                  <td><span className="badge badge-slate">{c.type}</span></td>
                  <td>{c.party}</td>
                  <td className="text-sm subtle">{c.prop}</td>
                  <td className="strong">{c.value}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="text-sm subtle">{c.ends}</td>
                  <td>
                    <button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="PDF">
                      <Icon name="contract" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
