import { PageHeader, StatCard, Section, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { sampleAudit } from "../../../lib/sample";

const actionTone: Record<string, string> = {
  "tenant.suspended": "badge-amber",
  "subscription.past_due": "badge-red",
  "contract.signed": "badge-green",
  "transfer.executed": "badge-blue",
  "lead.created": "badge-cyan",
};

export default function AuditoriaPage() {
  const rows = [...sampleAudit, ...sampleAudit];
  return (
    <>
      <PageHeader
        eyebrow="Plataforma · Compliance"
        title="Auditoria global"
        lead="Registro imutável de ações sensíveis em todos os tenants — inclusive decisões dos agentes de IA e ferramentas LGPD."
        actions={<button className="btn btn-outline btn-sm"><Icon name="receipt" /> Exportar</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="list" label="Eventos (24h)" value="4.281" tone="blue" />
        <StatCard icon="shield" label="Ações sensíveis" value="126" tone="accent" />
        <StatCard icon="bot" label="Ações de IA" value="1.940" tone="success" />
        <StatCard icon="flag" label="Pedidos LGPD" value="3" tone="warning" />
      </div>

      <Section title="Trilha de auditoria" action={<BackendNote endpoint="/admin/audit" />}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ação</th><th>Ator</th><th>Alvo</th><th>Quando</th></tr></thead>
            <tbody>
              {rows.map((a, i) => (
                <tr key={i}>
                  <td><span className={`badge ${actionTone[a.action] ?? "badge-slate"}`}>{a.action}</span></td>
                  <td className="text-sm">{a.actor}</td>
                  <td className="strong text-sm">{a.target}</td>
                  <td className="text-sm subtle">{a.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
