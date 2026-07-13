import { PageHeader, StatCard, Section, StatusBadge, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import {
  fetchPersons,
  fetchProperties,
  fetchPropertyTypes,
  formatPrice,
  propertyKindLabel,
  propertyPurposeLabel,
  type Property,
} from "../../../lib/api";
import { sampleProperties } from "../../../lib/sample";
import { PropertyTypeManager } from "./PropertyTypeManager";
import { PropertyOwnersCell } from "./PropertyOwnersCell";

export default async function ImoveisPage() {
  const [liveProps, liveTypes, liveLocadores] = await Promise.all([
    fetchProperties(),
    fetchPropertyTypes(),
    fetchPersons("LOCADOR"),
  ]);
  const properties: Property[] = liveProps ?? sampleProperties;
  const isLive = liveProps !== null;
  const types = liveTypes ?? [];
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  // Candidatos a dono: pessoas com papel LOCADOR (para o vínculo imóvel↔dono).
  const ownerCandidates = (liveLocadores ?? []).map((p) => ({ id: p.id, fullName: p.fullName }));

  const count = (s: string) => properties.filter((p) => p.status === s).length;

  return (
    <>
      <PageHeader
        eyebrow="Cadastros · Módulo 7.1"
        title="Imóveis"
        lead="A fonte única de verdade do inventário. Finalidade (venda/locação) e tipo do imóvel (Apartamento, Casa…) são campos distintos, como no cadastro clássico de imobiliária."
        actions={
          <>
            <button className="btn btn-outline btn-sm"><Icon name="filter" /> Filtros</button>
            <button className="btn btn-primary btn-sm"><Icon name="plus" /> Novo imóvel</button>
          </>
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="building" label="Total no inventário" value={String(properties.length)} tone="blue" />
        <StatCard icon="check" label="Disponíveis" value={String(count("available"))} tone="success" />
        <StatCard icon="key" label="Alugados" value={String(count("rented"))} tone="accent" />
        <StatCard icon="target" label="Reservados" value={String(count("reserved"))} tone="warning" />
      </div>

      <Section
        title="Tipos de imóvel (lookup do tenant)"
        action={
          liveTypes !== null
            ? <span className="badge badge-green"><span className="dot" /> ao vivo · /v1/property-types</span>
            : <BackendNote endpoint="/v1/property-types" />
        }
      >
        <PropertyTypeManager types={types} live={liveTypes !== null} />
      </Section>

      <div className="mt-4">
        <Section
          title="Inventário"
          action={
            <div className="row gap-8">
              {isLive
                ? <span className="badge badge-green"><span className="dot" /> ao vivo · backend</span>
                : <BackendNote />}
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
                  <th>Código</th>
                  <th>Finalidade</th>
                  <th>Tipo</th>
                  <th>Localização</th>
                  <th>Donos</th>
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
                    <td className="text-xs subtle">{p.id}</td>
                    <td>
                      <span className="badge badge-slate">
                        {p.purpose
                          ? propertyPurposeLabel[p.purpose] ?? p.purpose
                          : propertyKindLabel[p.kind] ?? p.kind}
                      </span>
                    </td>
                    <td>{p.propertyTypeId ? typeName.get(p.propertyTypeId) ?? "—" : "—"}</td>
                    <td>{p.city ?? "—"}{p.state ? ` · ${p.state}` : ""}</td>
                    <td>
                      <PropertyOwnersCell
                        propertyId={p.id}
                        owners={p.owners ?? []}
                        candidates={ownerCandidates}
                        live={isLive}
                      />
                    </td>
                    <td className="strong">{formatPrice(p.priceCents)}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>
                      <button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="Ações">
                        <Icon name="ellipsis" size={15} />
                      </button>
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
