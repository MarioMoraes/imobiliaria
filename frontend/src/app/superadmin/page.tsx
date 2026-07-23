import { PageHeader, StatCard, Section, StatusBadge } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { fetchTenants } from "../../lib/api";
import { sampleTenants, sampleHealth, sampleAudit } from "../../lib/sample";

export default async function SuperadminHome() {
  const live = await fetchTenants();
  const tenants = live ?? sampleTenants;
  const active = tenants.filter((t) => t.status === "active").length;

  return (
    <>
      <PageHeader
        title="Visão geral da plataforma"
        actions={<button className="btn btn-primary btn-sm"><Icon name="plus" /> Novo Tenant</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="building" label={live ? "Tenants ativos (ao vivo)" : "Tenants ativos"} value={String(active)} trend="+3 no mês" feature />
        <StatCard icon="wallet" label="MRR" value="R$ 128,4k" trend="+8,1%" tone="success" />
        <StatCard icon="bot" label="Mensagens de IA (mês)" value="482k" tone="accent" />
        <StatCard icon="trendingDown" label="Churn" value="1,2%" trendDir="down" trend="-0,3pp" tone="blue" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <Section
          title="Tenants recentes"
          action={<a href="/superadmin/tenants" className="btn btn-ghost btn-sm">Ver todos <Icon name="arrowRight" size={14} /></a>}
        >
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Imobiliária</th><th>Plano</th><th>Imóveis</th><th>Status</th></tr></thead>
              <tbody>
                {tenants.slice(0, 5).map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="cell-main">
                        <span className="avatar" style={{ width: 32, height: 32, fontSize: "0.7rem" }}>{t.name.slice(0, 2).toUpperCase()}</span>
                        <span>
                          <span className="strong" style={{ display: "block" }}>{t.name}</span>
                          <span className="text-xs subtle">{t.slug}.officesai.com.br</span>
                        </span>
                      </div>
                    </td>
                    <td><span className="badge badge-blue">{("plan" in t ? t.plan : "—").toString()}</span></td>
                    <td className="strong">{"props" in t ? t.props : "—"}</td>
                    <td><StatusBadge status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="stack">
          <Section title="Saúde da plataforma" action={<a href="/superadmin/saude" className="btn btn-ghost btn-sm">Detalhes</a>} pad>
            <div className="stack" style={{ gap: 10 }}>
              {sampleHealth.slice(0, 4).map((h) => (
                <div key={h.name} className="row-between">
                  <span className="row gap-8 text-sm"><Icon name="server" size={15} /> {h.name}</span>
                  <div className="row gap-8">
                    <span className="text-xs subtle">{h.latency}</span>
                    <StatusBadge status={h.status} />
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Auditoria global" action={<a href="/superadmin/auditoria" className="btn btn-ghost btn-sm">Tudo</a>}>
            <div className="card-pad timeline">
              {sampleAudit.slice(0, 4).map((a, i) => (
                <div className="timeline-item" key={i}>
                  <div className="text-sm strong">{a.action}</div>
                  <div className="text-xs subtle">{a.actor} · {a.target} · {a.when}</div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
