import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import {
  PageHeader,
  StatCard,
  Section,
  StatusBadge,
  EmptyState,
} from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { CashFlowChart } from "../../../components/CashFlowChart";
import {
  fetchAiCredits,
  fetchCashFlow,
  fetchDashboardSummary,
  fetchProperties,
  formatDay,
  formatPrice,
  propertyKindLabel,
  type AiCredits,
  type CashFlowPoint,
  type DashboardReceivableBrief,
  type DashboardSummary,
} from "../../../lib/api";

/**
 * Painel inicial. Todos os números vêm do backend: /v1/dashboard/summary
 * (agregações de imóveis, contratos, pessoas e financeiro) + /v1/properties
 * para a lista de imóveis recentes. Não há dado de exemplo aqui — quando ainda
 * não existe movimento, cada bloco mostra o próprio estado vazio.
 *
 * O bloco financeiro vem nulo para quem não tem permissão de finanças; nesse
 * caso o painel troca os cards de dinheiro por indicadores da carteira.
 */

/**
 * Saudação conforme o horário no fuso de São Paulo (o dashboard renderiza no
 * servidor, que pode estar em UTC — por isso fixamos o timezone brasileiro).
 */
function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

/** Valores grandes em cards ficam melhores abreviados: 86.400.00 → "R$ 86,4 mil". */
function compactPrice(cents: number): string {
  const reais = cents / 100;
  if (reais >= 1_000_000) {
    return `R$ ${(reais / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  }
  if (reais >= 10_000) {
    return `R$ ${(reais / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  }
  return formatPrice(cents);
}

/** Janela do gráfico: 6 meses para trás, incluindo o corrente (igual à Gestão Financeira). */
const CASH_FLOW_MONTHS = 6;

export default async function DashboardPage() {
  // O fluxo de caixa vem do MESMO endpoint que alimenta a Gestão Financeira
  // (`/v1/receivables/cash-flow`) para as duas telas não poderem divergir.
  // Quem não tem `finance:read` recebe null aqui e também `summary.finance`
  // nulo — o gráfico simplesmente não entra.
  const [summary, properties, credits, cashFlow, clerkUser] = await Promise.all([
    fetchDashboardSummary(),
    fetchProperties(),
    fetchAiCredits(),
    fetchCashFlow(CASH_FLOW_MONTHS).then((c) => c ?? []),
    currentUser().catch(() => null),
  ]);

  const firstName =
    clerkUser?.firstName ?? clerkUser?.fullName?.split(" ")[0] ?? "bem-vindo";

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName} 👋`}
        actions={
          <Link href="/imoveis" className="btn btn-primary btn-sm">
            <Icon name="plus" /> Novo imóvel
          </Link>
        }
      />

      {summary === null ? (
        <Section>
          <EmptyState
            icon="server"
            title="Não foi possível carregar os indicadores"
            hint="O backend não respondeu. Confira se a API está no ar (npm run dev:backend) e recarregue a página."
          />
        </Section>
      ) : (
        <>
          <Stats summary={summary} credits={credits} />

          <div className="grid" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
            <div className="stack">
              {summary.finance && <RevenueChart points={cashFlow} />}
              <RecentProperties properties={properties} />
            </div>

            <div className="stack">
              {summary.finance && (
                <>
                  {/* Os mesmos aluguéis que a lista de contas a receber do
                      Financeiro mostra no mês corrente — inclusive os já pagos,
                      senão as duas telas divergiriam. Por isso o título fala em
                      "vencimentos do mês", não em "próximos". */}
                  <ReceivablesList
                    title="Vencimentos do mês"
                    items={summary.finance.upcoming}
                    emptyTitle="Nenhum aluguel neste mês"
                    emptyHint="Os aluguéis que vencem no mês corrente aparecem aqui, em ordem de vencimento."
                  />
                  <ReceivablesList
                    title="Em atraso"
                    items={summary.finance.overdue}
                    emptyTitle="Nenhuma parcela vencida"
                    emptyHint="Tudo em dia por aqui."
                    highlight
                  />
                </>
              )}
              {/* Sem o bloco financeiro a coluna ficaria vazia — a carteira
                  entra completa; com ele, entra resumida. */}
              <Carteira summary={summary} compact={Boolean(summary.finance)} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ Cards */

function Stats({
  summary,
  credits,
}: {
  summary: DashboardSummary;
  credits: AiCredits | null;
}) {
  const { properties, contracts, finance } = summary;
  return (
    <div className="grid grid-4 mb-4">
      <StatCard
        icon="building"
        label="Imóveis disponíveis"
        value={String(properties.available)}
        trend={
          properties.createdLast30Days > 0
            ? `+${properties.createdLast30Days} em 30 dias`
            : undefined
        }
        tone="blue"
      />
      <StatCard
        icon="contract"
        label="Contratos vigentes"
        value={String(contracts.active)}
        trend={
          contracts.endingSoon > 0
            ? `${contracts.endingSoon} vencem em 90 dias`
            : undefined
        }
        trendDir="down"
        tone="accent"
      />
      {finance ? (
        <StatCard
          icon="clock"
          label="Em atraso"
          value={compactPrice(finance.overdueCents)}
          trend={
            finance.overdueCount > 0
              ? `${finance.overdueCount} parcela${finance.overdueCount > 1 ? "s" : ""}`
              : undefined
          }
          trendDir="down"
          tone="warning"
        />
      ) : (
        <StatCard
          icon="key"
          label="Imóveis alugados"
          value={String(properties.rented)}
          tone="success"
        />
      )}
      {/* Último da linha e em destaque, a pedido: é o indicador que decide se a
          equipe consegue usar o assistente hoje. `feature` pinta o card com o
          gradiente da marca, então o `tone` só vale se o destaque sair. */}
      <StatCard
        icon="sparkles"
        label="Créditos de IA"
        value={credits ? credits.available.toLocaleString("pt-BR") : "—"}
        trend={
          credits && credits.used > 0
            ? `${credits.used.toLocaleString("pt-BR")} consumidos`
            : undefined
        }
        tone="accent"
        feature
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Gráfico */

/**
 * Mesmo gráfico da Gestão Financeira — mesmo componente, mesma série do
 * backend. O painel tinha uma versão própria, só com a barra de recebido e
 * lendo outra consulta; a duplicação era o que fazia as duas telas mostrarem
 * números diferentes para o mesmo mês.
 */
function RevenueChart({ points }: { points: CashFlowPoint[] }) {
  return (
    <Section
      title="Recebido X Previsto"
      action={<span className="badge badge-blue">{CASH_FLOW_MONTHS} meses</span>}
      pad
    >
      <CashFlowChart points={points} />
    </Section>
  );
}

/* ------------------------------------------------------- Imóveis recentes */

function RecentProperties({
  properties,
}: {
  properties: Awaited<ReturnType<typeof fetchProperties>>;
}) {
  const lista = properties ?? [];
  return (
    <Section
      title="Imóveis recentes"
      action={
        <Link href="/imoveis" className="btn btn-ghost btn-sm">
          Ver todos <Icon name="arrowRight" size={14} />
        </Link>
      }
    >
      {lista.length === 0 ? (
        <EmptyState
          icon="building"
          title="Nenhum imóvel cadastrado"
          hint="Cadastre o primeiro imóvel para começar a acompanhar a carteira por aqui."
          action={
            <Link href="/imoveis" className="btn btn-primary btn-sm">
              <Icon name="plus" /> Cadastrar imóvel
            </Link>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Imóvel</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lista.slice(0, 5).map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="cell-main">
                      <span className="thumb" />
                      <span>
                        <span className="strong" style={{ display: "block" }}>
                          {p.title}
                        </span>
                        <span className="text-xs subtle">
                          {p.city}
                          {p.state ? ` · ${p.state}` : ""}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td>{propertyKindLabel[p.kind] ?? p.kind}</td>
                  <td className="strong">{formatPrice(p.priceCents)}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ----------------------------------------------------- Contas a receber */

/**
 * Segunda linha do item: a mesma "Descrição" da lista do Financeiro
 * ("Aluguel 3/12"), que diz mais do que o tipo da cobrança. O tipo só entra
 * quando não há descrição — caso das cobranças avulsas. Quando o pagador é
 * desconhecido, a descrição já virou o título e não se repete aqui.
 */
function detail(r: DashboardReceivableBrief): string {
  const kind = r.kind ? r.kind.toLowerCase() : "cobrança";
  if (!r.payerName) return kind;
  return r.description ?? kind;
}

/**
 * Mesma derivação da lista do Financeiro: uma parcela ABERTA cujo vencimento já
 * passou aparece como vencida, porque a virada ABERTO→VENCIDO depende de uma
 * rotina que pode não ter rodado ainda.
 */
function displayStatus(r: DashboardReceivableBrief, today: string): string {
  return r.status === "ABERTO" && r.dueDate < today ? "VENCIDO" : r.status;
}

function ReceivablesList({
  title,
  items,
  emptyTitle,
  emptyHint,
  highlight = false,
}: {
  title: string;
  items: DashboardReceivableBrief[];
  emptyTitle: string;
  emptyHint: string;
  highlight?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Section
      title={title}
      action={
        items.length > 0 ? (
          <Link href="/financeiro/gestao" className="btn btn-ghost btn-sm">
            Ver todas <Icon name="arrowRight" size={14} />
          </Link>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <EmptyState icon="receipt" title={emptyTitle} hint={emptyHint} />
      ) : (
        <div className="card-pad stack" style={{ gap: 12 }}>
          {items.map((r) => (
            <div key={r.id} className="row-between">
              <div>
                <span className="text-sm strong" style={{ display: "block" }}>
                  {r.payerName ?? r.description ?? "Cobrança avulsa"}
                </span>
                {/* "venc." e não "vence": a lista do mês inclui parcelas cujo
                    vencimento já passou. */}
                <span className="text-xs subtle">
                  venc. {formatDay(r.dueDate)} · {detail(r)}
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="text-sm strong tabular" style={{ display: "block" }}>
                  {formatPrice(r.amountCents)}
                </span>
                <StatusBadge status={highlight ? "VENCIDO" : displayStatus(r, today)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ----------------------------------------------------------- Carteira */

function Carteira({
  summary,
  compact = false,
}: {
  summary: DashboardSummary;
  compact?: boolean;
}) {
  const { properties, contracts, persons } = summary;
  const linhas: { icon: string; label: string; value: number; href: string }[] = [
    { icon: "building", label: "Imóveis na carteira", value: properties.total, href: "/imoveis" },
    { icon: "key", label: "Alugados", value: properties.rented, href: "/imoveis" },
    { icon: "user", label: "Locadores", value: persons.landlords, href: "/proprietarios" },
    { icon: "users", label: "Locatários", value: persons.tenants, href: "/clientes" },
    { icon: "shield", label: "Fiadores", value: persons.guarantors, href: "/fiadores" },
    { icon: "edit", label: "Contratos em assinatura", value: contracts.inSignature, href: "/imoveis" },
  ];

  return (
    <Section title="Carteira">
      <div className="card-pad stack" style={{ gap: 10 }}>
        {(compact ? linhas.slice(0, 4) : linhas).map((l) => (
          <Link key={l.label} href={l.href} className="row-between">
            <span className="row gap-8">
              <span className="stat-icon" style={{ width: 30, height: 30, margin: 0, borderRadius: 9 }}>
                <Icon name={l.icon} size={15} />
              </span>
              <span className="text-sm">{l.label}</span>
            </span>
            <span className="strong tabular">{l.value}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}
