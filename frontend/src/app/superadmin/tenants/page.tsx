import { PageHeader, StatCard, Section, StatusBadge, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { fetchTenants, formatDate } from "../../../lib/api";
import { sampleTenants } from "../../../lib/sample";

export default async function TenantsPage() {
  const live = await fetchTenants();
  const isLive = live !== null;
  // Normaliza para exibir métricas (o backend real ainda não traz props/agents).
  const tenants = live
    ? live.map((t) => ({ ...t, props: 0, agents: 0 }))
    : sampleTenants;

  return (
    <>
      <PageHeader
        eyebrow="Plataforma · Super Admin"
        title="Tenants"
        lead="Todas as imobiliárias da plataforma — criação, suspensão, plano e uso. Gerido pelo endpoint real /admin/tenants."
        actions={<button className="btn btn-primary btn-sm"><Icon name="plus" /> Novo tenant</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="building" label="Total de tenants" value={String(tenants.length)} tone="blue" />
        <StatCard icon="check" label="Ativos" value={String(tenants.filter((t) => t.status === "active").length)} tone="success" />
        <StatCard icon="sparkles" label="Em trial" value={String(tenants.filter((t) => t.status === "trial" as string).length)} tone="accent" />
        <StatCard icon="x" label="Suspensos" value={String(tenants.filter((t) => t.status === "suspended").length)} tone="warning" />
      </div>

      <Section
        title="Imobiliárias"
        action={isLive
          ? <span className="badge badge-green"><span className="dot" /> ao vivo · /admin/tenants</span>
          : <BackendNote endpoint="/admin/tenants" />}
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Imobiliária</th><th>Plano</th><th>Imóveis</th><th>Agentes IA</th><th>Criado em</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="cell-main">
                      <span className="avatar" style={{ width: 34, height: 34, fontSize: "0.72rem" }}>{t.name.slice(0, 2).toUpperCase()}</span>
                      <span>
                        <span className="strong" style={{ display: "block" }}>{t.name}</span>
                        <span className="text-xs subtle">{t.slug}.moveai.com.br</span>
                      </span>
                    </div>
                  </td>
                  <td><span className="badge badge-blue">{t.plan}</span></td>
                  <td className="strong">{t.props || "—"}</td>
                  <td>{t.agents || "—"}</td>
                  <td className="text-sm subtle">{t.createdAt ? formatDate(t.createdAt) : "—"}</td>
                  <td><StatusBadge status={t.status} /></td>
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
