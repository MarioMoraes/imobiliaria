import { PageHeader } from "../../../components/ui";
import {
  fetchClauses,
  fetchInspectionItems,
  fetchPropertyTypes,
} from "../../../lib/api";
import { TabelasGrid } from "./TabelasGrid";

/**
 * Tabelas auxiliares (lookups) do tenant: Tipos de imóvel, Cláusulas
 * contratuais e Itens de vistoria. Exibe um grid de cards — um por cadastro;
 * clicar em um card abre um popup para gerenciar aquele item.
 */
export default async function TabelasPage() {
  const [liveTypes, liveClauses, liveItems] = await Promise.all([
    fetchPropertyTypes(),
    fetchClauses(),
    fetchInspectionItems(),
  ]);

  return (
    <>
      <PageHeader title="Tabelas" />
      <TabelasGrid
        types={liveTypes ?? []}
        clauses={liveClauses ?? []}
        items={liveItems ?? []}
        liveTypes={liveTypes !== null}
        liveClauses={liveClauses !== null}
        liveItems={liveItems !== null}
      />
    </>
  );
}
