import { PageHeader, StatCard, Section, StatusBadge, EmptyState, BackendNote } from "../../../components/ui";
import { fetchPersons } from "../../../lib/api";
import { PersonFormButton } from "../clientes/PersonFormButton";

/**
 * Proprietários (locadores) — view por papel do cadastro unificado `persons`
 * (role=LOCADOR). Mesma ficha completa; o vínculo com imóveis é feito na tela
 * de Imóveis (property_owners).
 */
export default async function ProprietariosPage() {
  const live = await fetchPersons("LOCADOR");
  const owners = live ?? [];
  const isLive = live !== null;

  return (
    <>
      <PageHeader
        eyebrow="Cadastros · Proprietários (role LOCADOR)"
        title="Proprietários"
        lead="Dados, contas de repasse e documentos dos proprietários. Repasse liberado após compensação do pagamento do inquilino. Vincule imóveis a donos na tela de Imóveis."
        actions={<PersonFormButton defaultRoles={["LOCADOR"]} label="Novo proprietário" title="Novo proprietário" />}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="user" label="Proprietários" value={String(owners.length)} tone="blue" />
        <StatCard icon="check" label="Ativos" value={String(owners.filter((o) => o.status === "active").length)} tone="success" />
        <StatCard icon="building" label="Pessoa Física" value={String(owners.filter((o) => o.personType === "PF").length)} tone="accent" />
        <StatCard icon="shield" label="Pessoa Jurídica" value={String(owners.filter((o) => o.personType === "PJ").length)} tone="warning" />
      </div>

      <Section
        title="Proprietários"
        action={
          isLive
            ? <span className="badge badge-green"><span className="dot" /> ao vivo · /v1/persons?role=LOCADOR</span>
            : <BackendNote endpoint="/v1/persons?role=LOCADOR" />
        }
      >
        {owners.length === 0 ? (
          <EmptyState
            icon="user"
            title={isLive ? "Nenhum proprietário ainda" : "Backend offline"}
            hint={isLive ? "Cadastre o primeiro proprietário no botão acima." : "Suba a infra e o backend (npm run dev)."}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome / Razão social</th><th>Tipo</th><th>CPF/CNPJ</th>
                  <th>Contato</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {owners.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <div className="cell-main">
                        <span className="avatar" style={{ width: 34, height: 34, fontSize: "0.72rem" }}>
                          {o.fullName.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="strong">{o.fullName}</span>
                      </div>
                    </td>
                    <td><span className="badge badge-slate">{o.personType}</span></td>
                    <td className="text-sm subtle">{o.cpfCnpj ?? "—"}</td>
                    <td className="text-sm">{o.email ?? o.phone ?? o.mobile ?? "—"}</td>
                    <td><StatusBadge status={o.status} /></td>
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
