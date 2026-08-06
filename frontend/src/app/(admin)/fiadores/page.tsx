import { PageHeader, StatCard, Section, StatusBadge, EmptyState, initials, FilterNotice } from "../../../components/ui";
import { backendNotice, fetchPersons } from "../../../lib/api";
import { formatPhone } from "../../../lib/br-doc";
import { matches, readQuery } from "../../../lib/filter";
import { PersonFormButton } from "../clientes/PersonFormButton";
import { DeletePersonButton } from "../clientes/DeletePersonButton";

/**
 * Fiadores — view por papel do cadastro unificado `persons` (role=FIADOR). Mesma
 * ficha completa das demais partes; fiança de pessoa casada exige o cônjuge.
 */
export default async function FiadoresPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  // `q` vem da busca global do topo — a lista chega já filtrada.
  const q = await readQuery(searchParams);
  const live = await fetchPersons("FIADOR");
  const guarantors = (live ?? []).filter((p) =>
    matches(q, p.fullName, p.cpfCnpj, p.email, p.phone, p.mobile),
  );
  const isLive = live !== null;
  const notice = backendNotice();

  return (
    <>
      <PageHeader
        title="Fiadores"
        actions={<PersonFormButton defaultRoles={["FIADOR"]} label="Novo Fiador" title="Novo Fiador" />}
      />

      <FilterNotice term={q} count={guarantors.length} clearHref="/fiadores" />

      <div className="grid grid-4 mb-4">
        <StatCard icon="shield" label="Fiadores Cadastrados" value={String(guarantors.length)} tone="blue" />
        <StatCard icon="check" label="Ativos" value={String(guarantors.filter((g) => g.status === "active").length)} tone="success" />
        <StatCard icon="user" label="Pessoa Física" value={String(guarantors.filter((g) => g.personType === "PF").length)} tone="accent" />
        <StatCard icon="building" label="Pessoa Jurídica" value={String(guarantors.filter((g) => g.personType === "PJ").length)} tone="warning" />
      </div>

      <Section title="Fiadores">
        {guarantors.length === 0 ? (
          <EmptyState
            icon="shield"
            title={isLive ? "Nenhum fiador ainda" : "Não foi possível carregar"}
            hint={isLive ? "Cadastre o primeiro fiador no botão acima." : (notice ?? undefined)}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Nome</th><th>Tipo</th><th>Celular</th><th>Email</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {guarantors.map((g) => (
                  <tr key={g.id}>
                    <td className="cell-status tone-teal">
                      <div className="cell-main">
                        <span className="avatar-initials" style={{ width: 34, height: 34 }}>
                          {initials(g.fullName)}
                        </span>
                        <span className="strong">{g.fullName}</span>
                      </div>
                    </td>
                    <td><span className="badge badge-slate">{g.personType}</span></td>
                    <td className="text-sm tabular">{g.mobile ? formatPhone(g.mobile) : "—"}</td>
                    <td className="text-sm">{g.email || "—"}</td>
                    <td><StatusBadge status={g.status} /></td>
                    <td>
                      <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                        <PersonFormButton person={g} />
                        <DeletePersonButton id={g.id} name={g.fullName} />
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
