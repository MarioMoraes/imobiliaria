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
import {
  fetchDashboardSummary,
  fetchProperties,
  formatDay,
  formatPrice,
  propertyKindLabel,
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

/** "2026-07" → "Jul". */
function monthLabel(competence: string): string {
  const [, m] = competence.split("-");
  const nomes = [
    "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
    "Jul", "Ago", "Set", "Out", "Nov", "Dez",
  ];
  return nomes[Number(m) - 1] ?? competence;
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

export default async function DashboardPage() {
  const [summary, properties, clerkUser] = await Promise.all([
    fetchDashboardSummary(),
    fetchProperties(),
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
          <Stats summary={summary} />

          <div className="grid" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
            <div className="stack">
              {summary.finance && <RevenueChart summary={summary} />}
              <RecentProperties properties={properties} />
            </div>

            <div className="stack">
              {summary.finance && (
                <>
                  <ReceivablesList
                    title="Próximos vencimentos"
                    items={summary.finance.upcoming}
                    emptyTitle="Nada a vencer"
                    emptyHint="Quando houver parcelas em aberto, elas aparecem aqui em ordem de vencimento."
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

function Stats({ summary }: { summary: DashboardSummary }) {
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
        <>
          <StatCard
            icon="wallet"
            label="Recebido no mês"
            value={compactPrice(finance.receivedThisMonthCents)}
            trend={
              finance.openThisMonthCents > 0
                ? `${compactPrice(finance.openThisMonthCents)} em aberto`
                : undefined
            }
            tone="success"
            feature
          />
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
        </>
      ) : (
        <>
          <StatCard
            icon="key"
            label="Imóveis alugados"
            value={String(properties.rented)}
            tone="success"
          />
          <StatCard
            icon="users"
            label="Locatários ativos"
            value={String(summary.persons.tenants)}
            tone="warning"
          />
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Gráfico */

function RevenueChart({ summary }: { summary: DashboardSummary }) {
  const pontos = summary.finance?.monthlyRevenue ?? [];
  const max = Math.max(...pontos.map((p) => p.receivedCents), 1);
  const semMovimento = pontos.every((p) => p.receivedCents === 0);

  return (
    <Section
      title="Recebido por mês"
      action={<span className="badge badge-blue">Últimos {pontos.length} meses</span>}
      pad
    >
      {semMovimento ? (
        <EmptyState
          icon="wallet"
          title="Ainda sem recebimentos"
          hint="Assim que a primeira parcela for baixada como paga, o histórico aparece aqui."
        />
      ) : (
        <div className="chart">
          {pontos.map((p, i) => (
            <div
              key={p.month}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div
                className={`chart-bar${i === pontos.length - 1 ? "" : " muted"}`}
                // Altura relativa ao maior mês da série; mínimo de 2% para o mês
                // zerado continuar visível como base da barra.
                style={{
                  height: `${Math.max((p.receivedCents / max) * 100, 2)}%`,
                  width: "100%",
                }}
                title={`${monthLabel(p.month)}: ${formatPrice(p.receivedCents)}`}
              />
              <span className="text-xs subtle">{monthLabel(p.month)}</span>
            </div>
          ))}
        </div>
      )}
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
                <span className="text-xs subtle">
                  vence {formatDay(r.dueDate)}
                  {r.kind ? ` · ${r.kind.toLowerCase()}` : ""}
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="text-sm strong tabular" style={{ display: "block" }}>
                  {formatPrice(r.amountCents)}
                </span>
                <StatusBadge status={highlight ? "VENCIDO" : r.status} />
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
