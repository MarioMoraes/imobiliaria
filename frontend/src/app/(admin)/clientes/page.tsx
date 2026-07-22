import { PageHeader, StatCard, Section, initials, FilterNotice } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { fetchPersons } from "../../../lib/api";
import { formatPhone } from "../../../lib/br-doc";
import { sampleCustomers } from "../../../lib/sample";
import { matches, readQuery } from "../../../lib/filter";
import { PersonFormButton } from "./PersonFormButton";
import { DeletePersonButton } from "./DeletePersonButton";

const stageBadge: Record<string, string> = {
  LEAD: "badge-cyan",
  CLIENTE: "badge-blue",
  INQUILINO: "badge-green",
  COMPRADOR: "badge-green",
  INATIVO: "badge-slate",
};

/** Tom da faixa lateral por estágio — mesma escala de cores das fichas. */
const stageTone: Record<string, string> = {
  LEAD: "tone-ciano",
  CLIENTE: "tone-azul",
  INQUILINO: "tone-esmeralda",
  COMPRADOR: "tone-esmeralda",
  INATIVO: "tone-muted",
};

const intentLabel: Record<string, string> = { COMPRA: "Compra", LOCACAO: "Locação" };

/** Linha de exibição unificada (dado real do backend ou amostra de fallback). */
interface Row {
  id: string;
  name: string;
  stage: string;
  intent: string;
  mobile: string;
  email: string;
}

export default async function ClientesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  // `q` vem da busca global do topo — a lista chega já filtrada.
  const q = await readQuery(searchParams);
  const all = await fetchPersons();
  const isLive = all !== null;
  // "Clientes" = pessoas com papel de locatário (a mesma tabela `persons`;
  // proprietários/fiadores aparecem nas suas próprias views). O interesse em
  // comprar é distinguido pelo perfil de busca (intent = COMPRA), não por papel.
  const live =
    all
      ?.filter((p) => p.roles.some((r) => r === "LOCATARIO"))
      .filter((p) => matches(q, p.fullName, p.cpfCnpj, p.email, p.phone, p.mobile)) ?? null;

  const rows: Row[] = isLive && live
    ? live.map((c) => ({
        id: c.id,
        name: c.fullName,
        stage: c.stage,
        intent: c.searchProfiles[0] ? intentLabel[c.searchProfiles[0].intent] ?? "—" : "—",
        mobile: c.mobile ?? "",
        email: c.email ?? "",
      }))
    : sampleCustomers.map((c) => ({
        id: c.id,
        name: c.name,
        stage: c.stage,
        intent: c.intent,
        mobile: "",
        email: "",
      }));

  const count = (...stages: string[]) => rows.filter((r) => stages.includes(r.stage)).length;
  const leads = count("LEAD");
  const ativos = count("CLIENTE", "INQUILINO", "COMPRADOR");
  const inativos = count("INATIVO");

  return (
    <>
      <PageHeader
        title="Locatários"
        actions={<PersonFormButton defaultRoles={["LOCATARIO"]} label="Novo Locatário" title="Novo Locatário" />}
      />

      <FilterNotice term={q} count={rows.length} clearHref="/clientes" />

      <div className="grid grid-4 mb-4">
        <StatCard icon="users" label="Total na base" value={String(rows.length)} tone="blue" />
        <StatCard icon="target" label="Leads" value={String(leads)} tone="accent" />
        <StatCard icon="trendingUp" label="Locatários ativos" value={String(ativos)} tone="success" />
        <StatCard icon="x" label="Inativos" value={String(inativos)} tone="warning" />
      </div>

      <Section
        title="Locatários"
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Locatário</th><th>Estágio</th><th>Intenção</th><th>Celular</th><th>Email</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className={`cell-status ${stageTone[c.stage] ?? "tone-muted"}`}>
                    <div className="cell-main">
                      <span className="avatar-initials" style={{ width: 34, height: 34 }}>
                        {initials(c.name)}
                      </span>
                      <span className="strong">{c.name}</span>
                    </div>
                  </td>
                  <td><span className={`badge ${stageBadge[c.stage]}`}>{c.stage}</span></td>
                  <td>{c.intent}</td>
                  <td className="text-sm tabular">{c.mobile ? formatPhone(c.mobile) : "—"}</td>
                  <td className="text-sm">{c.email || "—"}</td>
                  <td>
                    {/* Editar/remover só com dado real (as linhas de amostra não
                        têm id no backend). */}
                    <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                      {isLive ? (
                        <>
                          <PersonFormButton person={{ id: c.id, fullName: c.name }} />
                          <DeletePersonButton id={c.id} name={c.name} />
                        </>
                      ) : (
                        <button className="icon-btn" style={{ width: 30, height: 30 }} disabled>
                          <Icon name="ellipsis" size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
