import { PageHeader, StatCard, Section, StatusBadge, EmptyState } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { fetchGuarantors } from "../../../lib/api";
import { GuarantorForm } from "./GuarantorForm";

const maritalLabel: Record<string, string> = {
  SOLTEIRO: "Solteiro(a)",
  CASADO: "Casado(a)",
  DIVORCIADO: "Divorciado(a)",
  VIUVO: "Viúvo(a)",
  UNIAO_ESTAVEL: "União estável",
};

export default async function FiadoresPage() {
  const live = await fetchGuarantors();
  const guarantors = live ?? [];
  const isLive = live !== null;

  return (
    <>
      <PageHeader
        eyebrow="Cadastros · Módulo 7 (MOD-FIADOR)"
        title="Fiadores"
        lead="Cadastro de fiadores para garantia de locação — ficha PF/PJ com cônjuge e endereço. Fiança de pessoa casada exige o cônjuge (validado no backend)."
        actions={
          isLive ? (
            <span className="badge badge-green"><span className="dot" /> ao vivo · /v1/guarantors</span>
          ) : (
            <span className="badge badge-amber"><Icon name="database" size={13} /> backend offline</span>
          )
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="shield" label="Fiadores cadastrados" value={String(guarantors.length)} tone="blue" />
        <StatCard icon="check" label="Ativos" value={String(guarantors.filter((g) => g.status === "active").length)} tone="success" />
        <StatCard icon="user" label="Pessoa Física" value={String(guarantors.filter((g) => g.personType === "PF").length)} tone="accent" />
        <StatCard icon="building" label="Pessoa Jurídica" value={String(guarantors.filter((g) => g.personType === "PJ").length)} tone="warning" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <Section title="Fiadores">
          {guarantors.length === 0 ? (
            <EmptyState
              icon="shield"
              title={isLive ? "Nenhum fiador ainda" : "Backend offline"}
              hint={isLive ? "Cadastre o primeiro fiador no formulário ao lado." : "Suba a infra e o backend (npm run dev) para carregar e gravar fiadores."}
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
                      <td className="text-sm subtle">{g.cpfCnpj}</td>
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

        <Section title="Novo fiador">
          <GuarantorForm />
        </Section>
      </div>
    </>
  );
}
