import {
  fetchContractTemplates,
  fetchContracts,
  fetchPersons,
  fetchProperties,
  type Contract,
} from "../../../lib/api";
import { ContractsView } from "./ContractsView";
import { matches, readQuery } from "../../../lib/filter";

/**
 * Contratos de locação — dado real de /v1/contracts + lookups (imóveis,
 * locatários, fiadores, templates). Se o backend não responder, cai numa lista
 * vazia (o gatilho de novo contrato fica desabilitado via `isLive`).
 */
export default async function ContratosPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  // `q` vem da busca global do topo — a lista chega já filtrada.
  const q = await readQuery(searchParams);
  const [liveContracts, liveProps, liveLocatarios, liveFiadores, liveTemplates] =
    await Promise.all([
      fetchContracts(),
      fetchProperties(),
      fetchPersons("LOCATARIO"),
      fetchPersons("FIADOR"),
      fetchContractTemplates(),
    ]);

  const contracts: Contract[] = (liveContracts ?? []).filter((c) =>
    matches(q, c.code, ...c.parties.map((party) => party.personName)),
  );

  return (
    <ContractsView
      contracts={contracts}
      properties={liveProps ?? []}
      locatarios={liveLocatarios ?? []}
      fiadores={liveFiadores ?? []}
      templates={liveTemplates ?? []}
      isLive={liveContracts !== null}
      filterTerm={q}
    />
  );
}
