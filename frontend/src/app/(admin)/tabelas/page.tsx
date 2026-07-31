import { PageHeader } from "../../../components/ui";
import {
  backendNotice,
  fetchClauses,
  fetchContractTemplates,
  fetchDistricts,
  fetchEvents,
  fetchInspectionItems,
  fetchMergeFields,
  fetchPropertyTypes,
} from "../../../lib/api";
import { TabelasGrid } from "./TabelasGrid";

/**
 * Tabelas auxiliares (lookups) do tenant: Tipos de imóvel, Cláusulas
 * contratuais, Modelos de contrato e Itens de vistoria. Exibe um grid de
 * cards — um por cadastro; clicar em um card abre um popup para gerenciar
 * aquele item.
 */
export default async function TabelasPage() {
  const [
    liveTypes,
    liveClauses,
    liveTemplates,
    mergeFields,
    liveItems,
    liveDistricts,
    liveEvents,
  ] = await Promise.all([
    fetchPropertyTypes(),
    fetchClauses(),
    // `true`: a manutenção também edita os modelos desativados.
    fetchContractTemplates(true),
    fetchMergeFields(),
    fetchInspectionItems(),
    fetchDistricts(),
    fetchEvents(),
  ]);
  // Depois das leituras: é delas que sai o diagnóstico exibido nos popups.
  const notice = backendNotice();

  return (
    <>
      <PageHeader title="Tabelas" />
      <TabelasGrid
        types={liveTypes ?? []}
        clauses={liveClauses ?? []}
        templates={liveTemplates ?? []}
        mergeFields={mergeFields ?? []}
        items={liveItems ?? []}
        districts={liveDistricts ?? []}
        events={liveEvents ?? []}
        liveTypes={liveTypes !== null}
        liveClauses={liveClauses !== null}
        liveTemplates={liveTemplates !== null}
        liveItems={liveItems !== null}
        liveDistricts={liveDistricts !== null}
        liveEvents={liveEvents !== null}
        notice={notice}
      />
    </>
  );
}
