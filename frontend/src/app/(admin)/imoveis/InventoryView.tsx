import Link from "next/link";
import { PageHeader, StatCard, Section, StatusBadge } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import {
  formatPrice,
  propertyKindLabel,
  propertyPurposeLabel,
  type Condominium,
  type District,
  type Employee,
  type Person,
  type Property,
  type PropertyType,
} from "../../../lib/api";
import { PropertyFormButton, type Opt } from "./PropertyFormButton";
import { DeletePropertyButton } from "./DeletePropertyButton";

/**
 * Ícone que representa o tipo do imóvel na lista. Faz match por palavra-chave
 * (sem acento) para funcionar também com tipos personalizados por tenant.
 */
function propertyTypeIcon(typeName: string | undefined): string {
  const t = (typeName ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/(casa|sobrado|resid|chac|sitio|fazenda|rural)/.test(t)) return "home";
  if (/(apart|apto|flat|kitnet|studio|cobertura|loft)/.test(t)) return "building";
  if (/(comerc|sala|loja|escrit|ponto)/.test(t)) return "store";
  if (/(galp|armaz|deposito|barrac|industr)/.test(t)) return "warehouse";
  if (/(terreno|lote|area|gleba)/.test(t)) return "tree";
  return "building";
}

/**
 * Tom (cor) de cada situação do imóvel, usado na faixa lateral da linha —
 * mesma escala de globals.css que colore as abas das fichas.
 */
const STATUS_TONE: Record<string, string> = {
  available: "tone-esmeralda",
  reserved: "tone-ambar",
  rented: "tone-indigo",
  sold: "tone-ciano",
  inactive: "tone-muted",
};

interface Props {
  /** Finalidade desta lista — governa rótulos, colunas e o form. */
  mode: "rent" | "sale";
  title: string;
  /** Imóveis já filtrados pela finalidade. */
  properties: Property[];
  types: PropertyType[];
  condominiums: Condominium[];
  districts: District[];
  employees: Employee[];
  /** Pessoas com papel LOCADOR (candidatas a proprietário). */
  locadores: Person[];
  isLive: boolean;
}

/**
 * Lista de inventário (tabela + indicadores) reutilizada pelas rotas
 * `/imoveis/alugar` (mode="rent") e `/imoveis/vender` (mode="sale"). O `mode`
 * é repassado ao formulário para exibir os campos certos de cada finalidade.
 */
export function InventoryView({
  mode,
  title,
  properties,
  types,
  condominiums,
  districts,
  employees,
  locadores,
  isLive,
}: Props) {
  const isSale = mode === "sale";
  const typeName = new Map(types.map((t) => [t.id, t.name]));

  const formOpts = {
    mode,
    types: types.map<Opt>((t) => ({ id: t.id, label: t.name })),
    condominiums: condominiums.map<Opt>((c) => ({ id: c.id, label: c.name })),
    districts: districts.map<Opt>((d) => ({ id: d.id, label: d.name })),
    employees: employees.map<Opt>((e) => ({ id: e.id, label: e.fullName })),
    ownerCandidates: locadores.map<Opt>((p) => ({
      id: p.id,
      label: p.fullName,
      sub: p.cpfCnpj ?? p.mobile ?? p.phone ?? undefined,
    })),
  };

  const count = (s: string) => properties.filter((p) => p.status === s).length;
  const soldCount = properties.filter((p) => p.status === "sold" || p.isSold).length;

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <>
            <Link href="/imoveis" className="btn btn-outline btn-sm">
              <Icon name="arrowRight" size={15} style={{ transform: "rotate(180deg)" }} /> Voltar
            </Link>
            <button className="btn btn-outline btn-sm"><Icon name="filter" /> Filtros</button>
            <PropertyFormButton {...formOpts} disabled={!isLive} />
          </>
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="building" label="Total no inventário" value={String(properties.length)} tone="blue" />
        <StatCard icon="check" label="Disponíveis" value={String(count("available"))} tone="success" />
        {isSale ? (
          <StatCard icon="banknote" label="Vendidos" value={String(soldCount)} tone="accent" />
        ) : (
          <StatCard icon="key" label="Alugados" value={String(count("rented"))} tone="accent" />
        )}
        <StatCard icon="target" label="Reservados" value={String(count("reserved"))} tone="warning" />
      </div>

      <div className="mt-4">
        <Section
          title="Imóveis Disponíveis"
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
                  <th>{isSale ? "Preço de Venda" : "Valor"}</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => (
                  <tr key={p.id}>
                    <td className={`cell-status ${STATUS_TONE[p.status] ?? "tone-muted"}`}>
                      <div className="cell-main">
                        <span className="thumb thumb-icon">
                          <Icon name={propertyTypeIcon(p.propertyTypeId ? typeName.get(p.propertyTypeId) : undefined)} size={20} />
                        </span>
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
                    <td className="strong tabular">{formatPrice(p.priceCents)}</td>
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
