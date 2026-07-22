import { PageHeader, StatCard, Section, StatusBadge, EmptyState, initials, FilterNotice } from "../../../components/ui";
import { fetchPersons } from "../../../lib/api";
import { formatPhone } from "../../../lib/br-doc";
import { matches, readQuery } from "../../../lib/filter";
import { PersonFormButton } from "../clientes/PersonFormButton";
import { DeletePersonButton } from "../clientes/DeletePersonButton";

/**
 * Proprietários (locadores) — view por papel do cadastro unificado `persons`
 * (role=LOCADOR). Mesma ficha completa; o vínculo com imóveis é feito na tela
 * de Imóveis (property_owners).
 */
export default async function ProprietariosPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  // `q` vem da busca global do topo — a lista chega já filtrada.
  const q = await readQuery(searchParams);
  const live = await fetchPersons("LOCADOR");
  const owners = (live ?? []).filter((p) =>
    matches(q, p.fullName, p.cpfCnpj, p.email, p.phone, p.mobile),
  );
  const isLive = live !== null;

  return (
    <>
      <PageHeader
        title="Locadores"
        actions={<PersonFormButton defaultRoles={["LOCADOR"]} label="Novo Locador" title="Novo Locador" />}
      />

      <FilterNotice term={q} count={owners.length} clearHref="/proprietarios" />

      <div className="grid grid-4 mb-4">
        <StatCard icon="user" label="Locadores" value={String(owners.length)} tone="blue" />
        <StatCard icon="check" label="Ativos" value={String(owners.filter((o) => o.status === "active").length)} tone="success" />
        <StatCard icon="building" label="Pessoa Física" value={String(owners.filter((o) => o.personType === "PF").length)} tone="accent" />
        <StatCard icon="shield" label="Pessoa Jurídica" value={String(owners.filter((o) => o.personType === "PJ").length)} tone="warning" />
      </div>

      <Section
        title="Locadores"
      >
        {owners.length === 0 ? (
          <EmptyState
            icon="user"
            title={isLive ? "Nenhum locador ainda" : "Backend offline"}
            hint={isLive ? "Cadastre o primeiro locador no botão acima." : "Suba a infra e o backend (npm run dev)."}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome / Razão social</th><th>Tipo</th><th>Celular</th>
                  <th>Contato</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {owners.map((o) => (
                  <tr key={o.id}>
                    <td className="cell-status tone-indigo">
                      <div className="cell-main">
                        <span className="avatar-initials" style={{ width: 34, height: 34 }}>
                          {initials(o.fullName)}
                        </span>
                        <span className="strong">{o.fullName}</span>
                      </div>
                    </td>
                    <td><span className="badge badge-slate">{o.personType}</span></td>
                    <td className="text-sm tabular">{o.mobile ? formatPhone(o.mobile) : "—"}</td>
                    <td className="text-sm">{o.email ?? (o.phone ? formatPhone(o.phone) : "—")}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td>
                      <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                        <PersonFormButton person={o} />
                        <DeletePersonButton id={o.id} name={o.fullName} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
