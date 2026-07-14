import { PageHeader, StatCard, Section, StatusBadge } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { sampleMaintenance } from "../../../lib/sample";

const statusLabel: Record<string, { s: string; l: string }> = {
  pending: { s: "pending", l: "Aguardando aprovação" },
  active: { s: "signing", l: "Em execução" },
  paid: { s: "paid", l: "Concluído" },
};

export default function ManutencaoPage() {
  return (
    <>
      <PageHeader
        title="Manutenção"
        actions={<button className="btn btn-primary btn-sm"><Icon name="plus" /> Abrir Chamado</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="wrench" label="Chamados abertos" value="9" tone="blue" />
        <StatCard icon="clock" label="Aguardando aprovação" value="3" tone="warning" />
        <StatCard icon="activity" label="Em execução" value="4" tone="accent" />
        <StatCard icon="check" label="Resolvidos (mês)" value="21" tone="success" />
      </div>

      <Section title="Chamados">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Chamado</th><th>Imóvel</th><th>Categoria</th><th>Solicitante</th><th>Custo est.</th><th>Status</th></tr></thead>
            <tbody>
              {sampleMaintenance.map((m) => (
                <tr key={m.id}>
                  <td className="strong">{m.id}</td>
                  <td>{m.prop}</td>
                  <td><span className="badge badge-slate">{m.cat}</span></td>
                  <td className="text-sm">{m.who}</td>
                  <td className="strong">{m.cost}</td>
                  <td><StatusBadge status={statusLabel[m.status].s} label={statusLabel[m.status].l} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
