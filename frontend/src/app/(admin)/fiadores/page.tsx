import { PageHeader, StatCard, Section, StatusBadge, EmptyState, initials } from "../../../components/ui";
import { fetchPersons } from "../../../lib/api";
import { PersonFormButton } from "../clientes/PersonFormButton";

const maritalLabel: Record<string, string> = {
  SOLTEIRO: "Solteiro(a)",
  CASADO: "Casado(a)",
  DIVORCIADO: "Divorciado(a)",
  VIUVO: "Viúvo(a)",
  UNIAO_ESTAVEL: "União estável",
};

/**
 * Fiadores — view por papel do cadastro unificado `persons` (role=FIADOR). Mesma
 * ficha completa das demais partes; fiança de pessoa casada exige o cônjuge.
 */
export default async function FiadoresPage() {
  const live = await fetchPersons("FIADOR");
  const guarantors = live ?? [];
  const isLive = live !== null;

  return (
    <>
      <PageHeader
        title="Fiadores"
        actions={<PersonFormButton defaultRoles={["FIADOR"]} label="Novo Fiador" title="Novo Fiador" />}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="shield" label="Fiadores cadastrados" value={String(guarantors.length)} tone="blue" />
        <StatCard icon="check" label="Ativos" value={String(guarantors.filter((g) => g.status === "active").length)} tone="success" />
        <StatCard icon="user" label="Pessoa Física" value={String(guarantors.filter((g) => g.personType === "PF").length)} tone="accent" />
        <StatCard icon="building" label="Pessoa Jurídica" value={String(guarantors.filter((g) => g.personType === "PJ").length)} tone="warning" />
      </div>

      <Section title="Fiadores">
        {guarantors.length === 0 ? (
          <EmptyState
            icon="shield"
            title={isLive ? "Nenhum fiador ainda" : "Backend offline"}
            hint={isLive ? "Cadastre o primeiro fiador no botão acima." : "Suba a infra e o backend (npm run dev) para carregar e gravar fiadores."}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Nome</th><th>Tipo</th><th>CPF/CNPJ</th><th>Estado civil</th><th>Cidade</th><th>Status</th></tr>
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
                    <td className="text-sm subtle tabular">{g.cpfCnpj ?? "—"}</td>
                    <td className="text-sm">{g.maritalStatus ? maritalLabel[g.maritalStatus] ?? g.maritalStatus : "—"}</td>
                    <td className="text-sm">
                      {g.addresses[0]?.city ?? "—"}
                      {g.addresses[0]?.state ? ` · ${g.addresses[0].state}` : ""}
                    </td>
                    <td><StatusBadge status={g.status} /></td>
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
