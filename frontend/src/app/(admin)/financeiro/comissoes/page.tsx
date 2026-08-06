import { PageHeader, Section, StatCard } from "../../../../components/ui";
import { BackendNotice } from "../../../../components/BackendNotice";
import {
  backendNotice,
  fetchBrokers,
  fetchCommissionSummary,
  fetchCommissions,
  fetchProperties,
  formatPrice,
} from "../../../../lib/api";
import { CommissionsPanel } from "./CommissionsPanel";

/**
 * Comissões (MOD-FIN-05).
 *
 * A venda do imóvel ainda é um módulo futuro; até lá esta tela é o lançamento
 * manual das vendas fechadas fora do sistema. Quando o módulo existir, ele vai
 * chamar `commissionService.createForSale` e as comissões nascem aqui sem
 * mudança de tela.
 *
 * Cada venda produz DUAS linhas: a comissão que a imobiliária recebe (receita) e
 * a parte do corretor (despesa). É o que faz a margem do negócio aparecer — o
 * líquido sozinho esconderia quanto foi pago a quem.
 */
export default async function ComissoesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status = ["ABERTO", "QUITADO", "CANCELADO"].includes(params.status ?? "")
    ? params.status
    : undefined;

  const month = new Date().toISOString().slice(0, 7);

  const [commissions, summary, brokers, properties] = await Promise.all([
    fetchCommissions({ status, limit: 200 }),
    fetchCommissionSummary(month),
    fetchBrokers().then((b) => b ?? []),
    fetchProperties().then((p) => p ?? []),
  ]);

  const notice = backendNotice();

  return (
    <>
      <PageHeader title="Comissões" backHref="/financeiro" />

      <div className="grid grid-4 mb-4">
        <StatCard
          icon="banknote"
          label="A Receber no Mês"
          value={formatPrice(summary?.receivableOpenCents ?? 0)}
          feature
        />
        <StatCard
          icon="wallet"
          label="Recebido no Mês"
          value={formatPrice(summary?.receivedCents ?? 0)}
          tone="success"
        />
        <StatCard
          icon="broker"
          label="A Pagar a Corretores"
          value={formatPrice(summary?.payableOpenCents ?? 0)}
          tone="warning"
        />
        <StatCard
          icon="trendingUp"
          label="Margem do Mês"
          value={formatPrice((summary?.receivedCents ?? 0) - (summary?.paidCents ?? 0))}
          tone="accent"
        />
      </div>

      <Section title="Lançamentos">
        <CommissionsPanel
          commissions={commissions ?? []}
          brokers={brokers}
          properties={properties}
          status={status ?? ""}
          live={commissions !== null}
        />
      </Section>

      {commissions === null && notice && <BackendNotice message={notice} />}
    </>
  );
}
