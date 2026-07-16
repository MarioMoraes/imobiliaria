import { currentUser } from "@clerk/nextjs/server";
import { PageHeader, StatCard, Section, StatusBadge } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { fetchProperties, formatPrice, propertyKindLabel } from "../../../lib/api";
import {
  sampleProperties,
  sampleAppointments,
  sampleConversations,
} from "../../../lib/sample";

const months = ["Fev", "Mar", "Abr", "Mai", "Jun", "Jul"];
const revenue = [58, 64, 61, 72, 78, 86];

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

export default async function DashboardPage() {
  const [live, clerkUser] = await Promise.all([
    fetchProperties(),
    currentUser().catch(() => null),
  ]);
  const properties = live ?? sampleProperties;
  const isLive = live !== null;
  const available = properties.filter((p) => p.status === "available").length;

  const firstName =
    clerkUser?.firstName ??
    clerkUser?.fullName?.split(" ")[0] ??
    "bem-vindo";

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName} 👋`}
        actions={
          <>
            <button className="btn btn-outline btn-sm">
              <Icon name="sparkles" /> Relatório com IA
            </button>
            <button className="btn btn-primary btn-sm">
              <Icon name="plus" /> Novo imóvel
            </button>
          </>
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard
          icon="building"
          label={isLive ? "Imóveis disponíveis (ao vivo)" : "Imóveis disponíveis"}
          value={String(available)}
          trend="+6 esta semana"
          tone="blue"
        />
        <StatCard icon="target" label="Leads no mês" value="147" trend="+23%" tone="accent" />
        <StatCard icon="contract" label="Contratos vigentes" value="312" trend="+4" tone="success" />
        <StatCard
          icon="wallet"
          label="Receita recebida (jul)"
          value="R$ 86,4k"
          trend="+10,2%"
          feature
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
        {/* Coluna esquerda */}
        <div className="stack">
          <Section
            title="Receita recebida por mês"
            action={<span className="badge badge-blue">Últimos 6 meses</span>}
            pad
          >
            <div className="chart">
              {revenue.map((v, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <div
                    className={`chart-bar${i === revenue.length - 1 ? "" : " muted"}`}
                    style={{ height: `${v}%`, width: "100%" }}
                    title={`${months[i]}: ${v}k`}
                  />
                  <span className="text-xs subtle">{months[i]}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Imóveis recentes"
            action={
              <a href="/imoveis" className="btn btn-ghost btn-sm">
                Ver todos <Icon name="arrowRight" size={14} />
              </a>
            }
          >
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
                  {properties.slice(0, 5).map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="cell-main">
                          <span className="thumb" />
                          <span>
                            <span className="strong" style={{ display: "block" }}>{p.title}</span>
                            <span className="text-xs subtle">
                              {p.city}{p.state ? ` · ${p.state}` : ""}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td>{propertyKindLabel[p.kind] ?? p.kind}</td>
                      <td className="strong">{formatPrice(p.priceCents)}</td>
                      <td><StatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        {/* Coluna direita */}
        <div className="stack">
          <Section
            title="Agentes de IA"
            action={
              <span className="badge badge-cyan">
                <span className="pulse-dot"><span /><span /></span> online
              </span>
            }
            pad
          >
            <div className="row-between mb-4">
              <div>
                <div className="stat-value" style={{ fontSize: "1.6rem" }}>28</div>
                <div className="stat-label">conversas hoje</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="stat-value" style={{ fontSize: "1.6rem" }}>81%</div>
                <div className="stat-label">resolvidas sem humano</div>
              </div>
            </div>
            <div className="bar mb-4"><span style={{ width: "81%" }} /></div>
            <div className="stack" style={{ gap: 10 }}>
              {sampleConversations.slice(0, 3).map((c, i) => (
                <div key={i} className="row-between">
                  <div className="row gap-8">
                    <span className="avatar" style={{ width: 30, height: 30, fontSize: "0.7rem" }}>
                      {c.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <span className="text-sm strong" style={{ display: "block" }}>{c.name}</span>
                      <span className="text-xs subtle">{c.channel}</span>
                    </span>
                  </div>
                  {c.status === "handoff" ? (
                    <span className="badge badge-red">Handoff</span>
                  ) : c.status === "active" ? (
                    <span className="badge badge-green"><span className="dot" /> Ativa</span>
                  ) : (
                    <span className="badge badge-slate">Encerrada</span>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Agenda de hoje" action={<a href="/agenda" className="btn btn-ghost btn-sm">Agenda</a>}>
            <div className="card-pad timeline">
              {sampleAppointments.slice(0, 4).map((a, i) => (
                <div className="timeline-item" key={i}>
                  <div className="row-between">
                    <span className="text-sm strong">{a.time} · {a.type}</span>
                    <StatusBadge status={a.status === "confirmed" ? "vigente" : "pending"} label={a.status === "confirmed" ? "Confirmado" : "Pendente"} />
                  </div>
                  <div className="text-xs subtle">{a.title} · {a.broker}</div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
