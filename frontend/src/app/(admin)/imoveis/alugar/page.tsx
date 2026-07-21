import {
  fetchCondominiums,
  fetchDistricts,
  fetchEmployees,
  fetchPersons,
  fetchProperties,
  fetchPropertyTypes,
  type Property,
} from "../../../../lib/api";
import { sampleProperties } from "../../../../lib/sample";
import { InventoryView } from "../InventoryView";
import { matches, readQuery } from "../../../../lib/filter";

/** Lista de imóveis para locação/temporada (`purpose` ≠ sale). */
export default async function ImoveisAlugarPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const q = await readQuery(searchParams);
  const [liveProps, liveTypes, liveCondos, liveDistricts, liveEmployees, liveLocadores] =
    await Promise.all([
      fetchProperties(),
      fetchPropertyTypes(),
      fetchCondominiums(),
      fetchDistricts(),
      fetchEmployees(),
      fetchPersons("LOCADOR"),
    ]);
  const all: Property[] = liveProps ?? sampleProperties;
  // `q` vem da busca global do topo — a lista chega já filtrada.
  const properties = all
    .filter((p) => p.purpose !== "sale")
    .filter((p) => matches(q, p.title, p.address, p.district, p.city, p.code));

  return (
    <InventoryView
      mode="rent"
      title="Imóveis a Alugar"
      properties={properties}
      types={liveTypes ?? []}
      condominiums={liveCondos ?? []}
      districts={liveDistricts ?? []}
      employees={liveEmployees ?? []}
      locadores={liveLocadores ?? []}
      isLive={liveProps !== null}
      filterTerm={q}
      clearHref="/imoveis/alugar"
    />
  );
}
