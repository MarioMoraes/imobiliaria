import { PageHeader, StatCard, Section, StatusBadge, EmptyState } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
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
        eyebrow="Cadastros · Fiadores (role FIADOR)"
        title="Fiadores"
        lead="Cadastro de fiadores para garantia de locação — ficha PF/PJ com cônjuge e endereço. Fiança de pessoa casada exige o cônjuge (validado no backend)."
        actions={
          <div className="row gap-8">
            {isLive ? (
              <span className="badge badge-green"><span className="dot" /> ao vivo · /v1/persons?role=FIADOR</span>
            ) : (
              <span className="badge badge-amber"><Icon name="database" size={13} /> backend offline</span>
            )}
            <PersonFormButton defaultRoles={["FIADOR"]} label="Novo fiador" title="Novo fiador" />
          </div>
        }
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
                    <td>
                      <div className="cell-main">
                        <span className="avatar" style={{ width: 34, height: 34, fontSize: "0.72rem" }}>
                          {g.fullName.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="strong">{g.fullName}</span>
                      </div>
                    </td>
                    <td><span className="badge badge-slate">{g.personType}</span></td>
                    <td className="text-sm subtle">{g.cpfCnpj ?? "—"}</td>
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
