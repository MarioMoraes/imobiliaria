import { PageHeader, StatCard, Section, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { fetchPersons, formatPrice, type Person } from "../../../lib/api";
import { sampleCustomers } from "../../../lib/sample";
import { PersonFormButton } from "./PersonFormButton";

const stageBadge: Record<string, string> = {
  LEAD: "badge-cyan",
  CLIENTE: "badge-blue",
  INQUILINO: "badge-green",
  COMPRADOR: "badge-green",
  INATIVO: "badge-slate",
};

const intentLabel: Record<string, string> = { COMPRA: "Compra", LOCACAO: "Locação" };
const sourceLabel: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  SITE: "Site",
  PORTAL: "Portal",
  INDICACAO: "Indicação",
  MANUAL: "Manual",
};

/** Linha de exibição unificada (dado real do backend ou amostra de fallback). */
interface Row {
  id: string;
  name: string;
  roles: string[];
  stage: string;
  intent: string;
  budget: string;
  source: string;
  broker: string;
}

const roleLabel: Record<string, string> = {
  LOCADOR: "Locador",
  LOCATARIO: "Locatário",
  FIADOR: "Fiador",
  COMPRADOR: "Comprador",
};

/** Deriva "orçamento" do perfil de busca primário (faixa min/max). */
function budgetOf(c: Person): string {
  const p = c.searchProfiles[0];
  if (!p) return "—";
  if (p.maxPriceCents && p.minPriceCents) {
    return `${formatPrice(p.minPriceCents)} – ${formatPrice(p.maxPriceCents)}`;
  }
  if (p.maxPriceCents) return `até ${formatPrice(p.maxPriceCents)}`;
  if (p.minPriceCents) return `a partir de ${formatPrice(p.minPriceCents)}`;
  return "—";
}

export default async function ClientesPage() {
  const all = await fetchPersons();
  const isLive = all !== null;
  // "Clientes" = pessoas com papel de locatário/comprador (a mesma tabela
  // `persons`; proprietários/fiadores aparecem nas suas próprias views).
  const live = all?.filter((p) => p.roles.some((r) => r === "LOCATARIO" || r === "COMPRADOR")) ?? null;

  const rows: Row[] = isLive && live
    ? live.map((c) => ({
        id: c.id,
        name: c.fullName,
        roles: c.roles,
        stage: c.stage,
        intent: c.searchProfiles[0] ? intentLabel[c.searchProfiles[0].intent] ?? "—" : "—",
        budget: budgetOf(c),
        source: sourceLabel[c.source] ?? c.source,
        broker: "—", // vínculo de corretor vem com o módulo broker (futuro)
      }))
    : sampleCustomers.map((c) => ({
        id: c.id,
        name: c.name,
        roles: [],
        stage: c.stage,
        intent: c.intent,
        budget: c.budget,
        source: c.source,
        broker: c.broker,
      }));

  const count = (...stages: string[]) => rows.filter((r) => stages.includes(r.stage)).length;
  const leads = count("LEAD");
  const ativos = count("CLIENTE", "INQUILINO", "COMPRADOR");
  const inativos = count("INATIVO");

  return (
    <>
      <PageHeader
        eyebrow="Cadastros · Módulo 7.3"
        title="Clientes"
        lead="Jornada unificada lead → cliente → inquilino/comprador. O perfil de busca alimenta a recomendação por IA."
        actions={<PersonFormButton defaultRoles={["LOCATARIO"]} label="Novo cliente" title="Novo cliente" />}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="users" label="Total na base" value={String(rows.length)} tone="blue" />
        <StatCard icon="target" label="Leads" value={String(leads)} tone="accent" />
        <StatCard icon="trendingUp" label="Clientes ativos" value={String(ativos)} tone="success" />
        <StatCard icon="x" label="Inativos" value={String(inativos)} tone="warning" />
      </div>

      <Section
        title="Base de clientes"
        action={
          isLive
            ? <span className="badge badge-green"><span className="dot" /> ao vivo · /v1/persons</span>
            : <BackendNote endpoint="/v1/persons" />
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Cliente</th><th>Papéis</th><th>Estágio</th><th>Intenção</th><th>Orçamento</th><th>Origem</th><th>Corretor</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="cell-main">
                      <span className="avatar" style={{ width: 34, height: 34, fontSize: "0.72rem" }}>
                        {c.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="strong">{c.name}</span>
                    </div>
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                      {c.roles.length === 0
                        ? <span className="text-sm subtle">—</span>
                        : c.roles.map((r) => (
                            <span key={r} className="badge badge-slate">{roleLabel[r] ?? r}</span>
                          ))}
                    </div>
                  </td>
                  <td><span className={`badge ${stageBadge[c.stage]}`}>{c.stage}</span></td>
                  <td>{c.intent}</td>
                  <td className="text-sm">{c.budget}</td>
                  <td className="text-sm subtle">{c.source}</td>
                  <td className="text-sm">{c.broker}</td>
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
