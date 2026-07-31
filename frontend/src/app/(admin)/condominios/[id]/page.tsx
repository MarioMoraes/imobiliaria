import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, StatCard, Section, EmptyState } from "../../../../components/ui";
import { Icon } from "../../../../components/Icon";
import { BackendNotice } from "../../../../components/BackendNotice";
import {
  backendNotice,
  fetchCondominium,
  fetchContracts,
  fetchPropertiesByCondominium,
  type Contract,
  type Property,
} from "../../../../lib/api";

/** Contratos que mantêm o imóvel ocupado (o locatário desses é o inquilino atual). */
const ACTIVE_CONTRACT = new Set(["VIGENTE", "RENOVADO"]);

/** Endereço estruturado do imóvel; cai no título quando não há logradouro. */
function formatAddress(p: Property): string {
  const line = [p.address, p.number].filter(Boolean).join(", ");
  return line || p.title || "—";
}

/** Nome(s) do(s) proprietário(s) — locador(es) — do imóvel. */
function ownersLabel(p: Property): string {
  if (!p.owners || p.owners.length === 0) return "—";
  return p.owners.map((o) => o.personName).join(", ");
}

/**
 * Mapa imóvel → nome(s) do(s) locatário(s) do contrato vigente. Só considera
 * contratos ativos (VIGENTE/RENOVADO); o último encontrado por imóvel vence.
 */
function tenantsByProperty(contracts: Contract[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of contracts) {
    if (!c.propertyId || !ACTIVE_CONTRACT.has(c.status)) continue;
    const names = c.parties
      .filter((party) => party.role === "LOCATARIO")
      .map((party) => party.personName);
    if (names.length > 0) map.set(c.propertyId, names.join(", "));
  }
  return map;
}

export default async function CondominosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [condominium, live, contracts] = await Promise.all([
    fetchCondominium(id),
    fetchPropertiesByCondominium(id),
    fetchContracts(),
  ]);

  // Condomínio inexistente (ou id inválido) com backend no ar → 404.
  if (condominium === null && live !== null) notFound();

  const properties: Property[] = live ?? [];
  const notice = backendNotice();
  const isLive = live !== null;
  const tenants = tenantsByProperty(contracts ?? []);

  return (
    <>
      <PageHeader
        title={condominium ? `Condôminos · ${condominium.name}` : "Condôminos"}
        backHref="/condominios"
        actions={
          <Link
            href={`/condominios/${id}/despesas`}
            className="btn btn-premium btn-sm"
            title="Lançamento de despesas do condomínio"
          >
            <Icon name="receipt" /> <span>Despesas</span>
          </Link>
        }
      />

      <div className="grid grid-3 mb-4">
        <StatCard
          icon="building"
          label="Número de Apartamentos"
          value={String(properties.length)}
          tone="blue"
        />
        <StatCard
          icon="key"
          label="Alugados"
          value={String(properties.filter((p) => p.status === "rented").length)}
          tone="success"
        />
        <StatCard
          icon="home"
          label="Disponíveis"
          value={String(properties.filter((p) => p.status !== "rented").length)}
          tone="accent"
        />
      </div>

      <div className="mt-4">
        <Section title="Consulta Condôminos">
          {properties.length === 0 ? (
            <div className="card-pad">
              <EmptyState
                icon="building"
                title={isLive ? "Nenhum imóvel neste condomínio" : "Não foi possível carregar"}
                hint={
                  isLive
                    ? "Vincule imóveis a este condomínio pelo cadastro de Imóveis."
                    : (notice ?? undefined)
                }
              />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "right" }}>Imóvel</th>
                    <th>Endereço</th>
                    <th>Alugado</th>
                    <th>Proprietário / Inquilino</th>
                  </tr>
                </thead>
                <tbody>
                  {properties.map((p) => {
                    const rented = p.status === "rented";
                    // Alugado → inquilino (locatário do contrato vigente); senão
                    // o proprietário (locador). Se não houver locatário no
                    // contrato, cai no locador para não deixar a célula vazia.
                    const tenant = tenants.get(p.id);
                    const party = rented && tenant ? tenant : ownersLabel(p);
                    return (
                      <tr key={p.id}>
                        <td style={{ textAlign: "right" }} className="strong num">
                          {p.code ?? "—"}
                        </td>
                        <td>{formatAddress(p)}</td>
                        <td>
                          {rented ? (
                            <span className="badge badge-green">Sim</span>
                          ) : (
                            <span className="badge badge-slate">Não</span>
                          )}
                        </td>
                        <td>
                          {party}
                          {rented && tenant ? (
                            <span className="subtle text-xs"> · inquilino</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      {!isLive && (
        <p className="text-xs subtle mt-4">
          <BackendNotice message={notice} />
        </p>
      )}
    </>
  );
}
