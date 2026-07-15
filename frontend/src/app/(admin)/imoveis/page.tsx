import { PageHeader, StatCard, Section, StatusBadge } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import {
  fetchCondominiums,
  fetchDistricts,
  fetchEmployees,
  fetchPersons,
  fetchProperties,
  fetchPropertyTypes,
  formatPrice,
  propertyKindLabel,
  propertyPurposeLabel,
  type Property,
} from "../../../lib/api";
import { sampleProperties } from "../../../lib/sample";
import { PropertyFormButton, type Opt } from "./PropertyFormButton";
import { DeletePropertyButton } from "./DeletePropertyButton";

export default async function ImoveisPage() {
  const [liveProps, liveTypes, liveCondos, liveDistricts, liveEmployees, liveLocadores] =
    await Promise.all([
      fetchProperties(),
      fetchPropertyTypes(),
      fetchCondominiums(),
      fetchDistricts(),
      fetchEmployees(),
      fetchPersons("LOCADOR"),
    ]);
  const properties: Property[] = liveProps ?? sampleProperties;
  const isLive = liveProps !== null;
  const types = liveTypes ?? [];
  const typeName = new Map(types.map((t) => [t.id, t.name]));

  // Opções dos dropdowns do formulário de imóvel.
  const typeOpts: Opt[] = types.map((t) => ({ id: t.id, label: t.name }));
  const condoOpts: Opt[] = (liveCondos ?? []).map((c) => ({ id: c.id, label: c.name }));
  const districtOpts: Opt[] = (liveDistricts ?? []).map((d) => ({ id: d.id, label: d.name }));
  const employeeOpts: Opt[] = (liveEmployees ?? []).map((e) => ({ id: e.id, label: e.fullName }));
  // Candidatos a proprietário: pessoas com papel LOCADOR.
  const ownerCandidates: Opt[] = (liveLocadores ?? []).map((p) => ({ id: p.id, label: p.fullName }));
  const formOpts = {
    types: typeOpts,
    condominiums: condoOpts,
    districts: districtOpts,
    employees: employeeOpts,
    ownerCandidates,
  };

  const count = (s: string) => properties.filter((p) => p.status === s).length;

  return (
    <>
      <PageHeader
        title="Imóveis"
        actions={
          <>
            <button className="btn btn-outline btn-sm"><Icon name="filter" /> Filtros</button>
            <PropertyFormButton {...formOpts} disabled={!isLive} />
          </>
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="building" label="Total no inventário" value={String(properties.length)} tone="blue" />
        <StatCard icon="check" label="Disponíveis" value={String(count("available"))} tone="success" />
        <StatCard icon="key" label="Alugados" value={String(count("rented"))} tone="accent" />
        <StatCard icon="target" label="Reservados" value={String(count("reserved"))} tone="warning" />
      </div>

      <div className="mt-4">
        <Section
          title="Inventário"
          action={
            <div className="row gap-8">
              <div className="search" style={{ padding: "7px 12px" }}>
                <Icon name="search" size={15} /> <span className="text-sm">Buscar…</span>
              </div>
            </div>
          }
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Imóvel</th>
                  <th>Finalidade</th>
                  <th>Tipo</th>
                  <th>Localização</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="cell-main">
                        <span className="thumb" />
                        <span className="strong">{p.title}</span>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-slate">
                        {p.purpose
                          ? propertyPurposeLabel[p.purpose] ?? p.purpose
                          : propertyKindLabel[p.kind] ?? p.kind}
                      </span>
                    </td>
                    <td>{p.propertyTypeId ? typeName.get(p.propertyTypeId) ?? "—" : "—"}</td>
                    <td>{p.city ?? "—"}{p.state ? ` · ${p.state}` : ""}</td>
                    <td className="strong">{formatPrice(p.priceCents)}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>
                      <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                        <PropertyFormButton property={p} {...formOpts} disabled={!isLive} />
                        <DeletePropertyButton id={p.id} title={p.title} disabled={!isLive} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
