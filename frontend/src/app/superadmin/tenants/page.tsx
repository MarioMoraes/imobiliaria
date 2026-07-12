import { PageHeader, StatCard, Section, BackendNote } from "../../../components/ui";
import { fetchTenants } from "../../../lib/api";
import { sampleTenants } from "../../../lib/sample";
import { TenantsManager, type TenantRow } from "./TenantsManager";

export default async function TenantsPage() {
  const live = await fetchTenants();
  const isLive = live !== null;
  // Normaliza para exibir métricas (o backend real ainda não traz props/agents).
  const tenants: TenantRow[] = live
    ? live.map((t) => ({ ...t, props: 0, agents: 0 }))
    : sampleTenants;

  return (
    <>
      <PageHeader
        eyebrow="Plataforma · Super Admin"
        title="Tenants"
        lead="Todas as imobiliárias da plataforma — criação, suspensão, plano e uso. Gerido pelo endpoint real /admin/tenants."
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
        <TenantsManager tenants={tenants} />
      </Section>
    </>
  );
}
