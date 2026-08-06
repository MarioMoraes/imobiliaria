import { PageHeader, StatCard, Section, StatusBadge, FilterNotice } from "../../../components/ui";
import {
  formatPrice,
  type Contract,
  type ContractTemplate,
  type Person,
  type Property,
} from "../../../lib/api";
import { formatPhone } from "../../../lib/br-doc";
import { ContractFormButton, type Opt } from "./ContractFormButton";
import { DeleteContractButton } from "./DeleteContractButton";

/** Contract status → chave visual do StatusBadge (reaproveita cores existentes). */
const STATUS_KEY: Record<string, string> = {
  RASCUNHO: "draft",
  EM_ASSINATURA: "signing",
  VIGENTE: "vigente",
  RENOVADO: "active",
  ENCERRADO: "canceled",
  DISTRATADO: "overdue",
};
/**
 * Tom (cor) de cada situação, usado na faixa lateral da linha. Reaproveita a
 * escala de tópicos de globals.css: a mesma esmeralda de "Assinatura" marca o
 * contrato vigente, o mesmo âmbar de "Situação" marca o que está em assinatura.
 */
const STATUS_TONE: Record<string, string> = {
  RASCUNHO: "tone-ardosia",
  EM_ASSINATURA: "tone-ambar",
  VIGENTE: "tone-esmeralda",
  RENOVADO: "tone-indigo",
  ENCERRADO: "tone-muted",
  DISTRATADO: "tone-danger",
};

const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: "Rascunho",
  EM_ASSINATURA: "Em assinatura",
  VIGENTE: "Vigente",
  RENOVADO: "Renovado",
  ENCERRADO: "Encerrado",
  DISTRATADO: "Distratado",
};

const READJUST_LABEL: Record<string, string> = {
  IPCA: "IPCA",
  IGP_M: "IGP-M",
  INPC: "INPC",
  FIXO: "Fixo",
};

/** "YYYY-MM-DD" → "dd/mm/aaaa"; null → "—". */
function dateBr(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Progresso da assinatura como marcas preenchidas — uma por parte. Lê-se de
 * relance quantas faltam, sem processar a fração "2/3".
 */
function SignProgress({ parties }: { parties: Contract["parties"] }) {
  const signed = parties.filter((p) => p.signedAt).length;
  return (
    <span
      className="row gap-8 tone-esmeralda"
      title={`${signed} de ${parties.length} assinaram`}
    >
      <span className="sign-ticks">
        {parties.map((p, i) => (
          <i key={p.id} className={`sign-tick${i < signed ? " is-on" : ""}`} />
        ))}
      </span>
      <span className="text-xs subtle tabular">
        {signed}/{parties.length}
      </span>
    </span>
  );
}

interface Props {
  contracts: Contract[];
  properties: Property[];
  locatarios: Person[];
  fiadores: Person[];
  templates: ContractTemplate[];
  isLive: boolean;
  /** Termo da busca global que filtrou esta lista (`?q=`), se houver. */
  filterTerm?: string;
}

/**
 * Lista de contratos de locação (tabela + indicadores). Reúne os lookups
 * (imóveis/pessoas/templates) e os repassa ao formulário em abas.
 */
export function ContractsView({ contracts, properties, locatarios, fiadores, templates, isLive, filterTerm = "" }: Props) {
  const propTitle = new Map(properties.map((p) => [p.id, p.title]));

  const personOpt = (p: Person): Opt => ({
    id: p.id,
    label: p.fullName,
    sub: p.cpfCnpj ?? (p.mobile ? formatPhone(p.mobile) : p.phone ? formatPhone(p.phone) : undefined),
  });

  const formOpts = {
    properties: properties.map<Opt>((p) => ({
      id: p.id,
      label: p.title,
      sub: [p.city, p.state].filter(Boolean).join(" · ") || undefined,
    })),
    templates: templates.map<Opt>((t) => ({ id: t.id, label: t.name })),
    locatarioCandidates: locatarios.map(personOpt),
    fiadorCandidates: fiadores.map(personOpt),
  };

  const count = (s: string) => contracts.filter((c) => c.status === s).length;

  return (
    <>
      <PageHeader
        title="Contratos"
        backHref="/imoveis"
        actions={
          <>
            <ContractFormButton {...formOpts} disabled={!isLive} />
          </>
        }
      />

      <FilterNotice term={filterTerm} count={contracts.length} clearHref="/contratos" />

      <div className="grid grid-4 mb-4">
        {/* Os indicadores usam a mesma cor que a situação tem na tabela. */}
        <StatCard icon="contract" label="Total" value={String(contracts.length)} tone="blue" />
        <StatCard icon="check" label="Vigentes" value={String(count("VIGENTE"))} tone="success" />
        <StatCard icon="clock" label="Em Assinatura" value={String(count("EM_ASSINATURA"))} tone="warning" />
        <StatCard icon="edit" label="Rascunhos" value={String(count("RASCUNHO"))} tone="accent" />
      </div>

      <div className="mt-4">
        <Section title="Contratos de Locação">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Contrato</th>
                  <th>Imóvel</th>
                  <th>Locatário</th>
                  <th>Valor</th>
                  <th>Reajuste</th>
                  <th>Status</th>
                  <th>Vigência</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contracts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-sm subtle" style={{ textAlign: "center", padding: "24px 0" }}>
                      Nenhum contrato cadastrado ainda.
                    </td>
                  </tr>
                ) : (
                  contracts.map((c) => {
                    const locatarioNames = c.parties.filter((p) => p.role === "LOCATARIO").map((p) => p.personName);
                    return (
                      <tr key={c.id}>
                        <td className={`strong tabular cell-status ${STATUS_TONE[c.status] ?? "tone-muted"}`}>
                          {c.code != null ? `Nº ${c.code}` : "—"}
                        </td>
                        <td className="text-sm">{c.propertyId ? propTitle.get(c.propertyId) ?? "—" : "—"}</td>
                        <td className="text-sm subtle">
                          {locatarioNames.length === 0
                            ? "—"
                            : locatarioNames.length === 1
                              ? locatarioNames[0]
                              : `${locatarioNames[0]} +${locatarioNames.length - 1}`}
                        </td>
                        <td className="strong tabular">{formatPrice(c.rentalValueCents)}</td>
                        <td className="text-sm">{READJUST_LABEL[c.readjustIndex] ?? c.readjustIndex}</td>
                        <td>
                          <div className="row gap-8" style={{ flexWrap: "wrap" }}>
                            <StatusBadge status={STATUS_KEY[c.status] ?? c.status} label={STATUS_LABEL[c.status]} />
                            {c.status === "EM_ASSINATURA" && c.parties.length > 0 && (
                              // Progresso vem de contract_parties.signed_at, espelhado pelo
                              // MOD-ASSINATURA — sem consulta extra ao provedor.
                              <SignProgress parties={c.parties} />
                            )}
                          </div>
                        </td>
                        <td className="text-sm subtle tabular">{dateBr(c.endsAt)}</td>
                        <td>
                          <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                            <ContractFormButton contract={c} {...formOpts} disabled={!isLive} />
                            <DeleteContractButton id={c.id} label={c.code != null ? `Nº ${c.code}` : c.id} disabled={!isLive} />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
