import { PageHeader, StatCard, Section } from "../../../components/ui";
import { fetchTenantCredits, fetchTenants } from "../../../lib/api";
import { sampleTenants } from "../../../lib/sample";
import { TenantsManager, type TenantRow } from "./TenantsManager";

export default async function TenantsPage() {
  const live = await fetchTenants();
  const isLive = live !== null;

  // Créditos de IA por tenant. Em paralelo, e não numa rota agregada, porque a
  // lista de tenants da plataforma é curta — o custo é uma consulta indexada
  // por linha, e evita inventar um endpoint só para esta tela.
  const credits = live
    ? await Promise.all(live.map((t) => fetchTenantCredits(t.id)))
    : [];

  // Normaliza para exibir métricas (o backend real ainda não traz props).
  const tenants: TenantRow[] = live
    ? live.map((t, i) => ({ ...t, props: 0, credits: credits[i] ?? null }))
    : sampleTenants;

  // Tenant sem crédito nenhum não consegue usar o assistente — é a informação
  // que faltava na plataforma, e por isso vira cartão.
  const semCredito = isLive
    ? credits.filter((c) => c !== null && c.available === 0).length
    : 0;

  return (
    <>
      <PageHeader title="Tenants" />

      <div className="grid grid-4 mb-4">
        <StatCard icon="building" label="Total de Tenants" value={String(tenants.length)} tone="blue" />
        <StatCard icon="check" label="Ativos" value={String(tenants.filter((t) => t.status === "active").length)} tone="success" />
        <StatCard icon="sparkles" label="Em Trial" value={String(tenants.filter((t) => t.status === "trial" as string).length)} tone="accent" />
        <StatCard
          icon="wallet"
          label="Sem Créditos de IA"
          value={String(semCredito)}
          tone="warning"
        />
      </div>

      <Section
        title="Imobiliárias"
      >
        <TenantsManager tenants={tenants} />
      </Section>
    </>
  );
}
