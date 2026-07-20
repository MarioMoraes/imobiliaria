import {
  fetchContractTemplates,
  fetchContracts,
  fetchPersons,
  fetchProperties,
  type Contract,
} from "../../../lib/api";
import { ContractsView } from "./ContractsView";

/**
 * Contratos de locação — dado real de /v1/contracts + lookups (imóveis,
 * locatários, fiadores, templates). Se o backend não responder, cai numa lista
 * vazia (o gatilho de novo contrato fica desabilitado via `isLive`).
 */
export default async function ContratosPage() {
  const [liveContracts, liveProps, liveLocatarios, liveFiadores, liveTemplates] =
    await Promise.all([
      fetchContracts(),
      fetchProperties(),
      fetchPersons("LOCATARIO"),
      fetchPersons("FIADOR"),
      fetchContractTemplates(),
    ]);

  const contracts: Contract[] = liveContracts ?? [];

  return (
    <ContractsView
      contracts={contracts}
      properties={liveProps ?? []}
      locatarios={liveLocatarios ?? []}
      fiadores={liveFiadores ?? []}
      templates={liveTemplates ?? []}
      isLive={liveContracts !== null}
    />
  );
}
