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

/** Lista de imóveis para locação/temporada (`purpose` ≠ sale). */
export default async function ImoveisAlugarPage() {
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
  const properties = all.filter((p) => p.purpose !== "sale");

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
    />
  );
}
