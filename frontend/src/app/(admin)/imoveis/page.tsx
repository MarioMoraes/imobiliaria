import Link from "next/link";
import { PageHeader } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { fetchProperties, type Property } from "../../../lib/api";
import { sampleProperties } from "../../../lib/sample";

/**
 * Hub de Imóveis: dois cards (padrão de /tabelas) que levam às listas por
 * finalidade — "Imóveis a Alugar" (locação/temporada) e "Imóveis a Vender".
 * A entidade é a mesma (`properties`); a separação é por `purpose`.
 */
export default async function ImoveisPage() {
  const liveProps = await fetchProperties();
  const properties: Property[] = liveProps ?? sampleProperties;
  const saleCount = properties.filter((p) => p.purpose === "sale").length;
  const rentCount = properties.length - saleCount;

  const cards = [
    {
      href: "/imoveis/alugar",
      title: "Imóveis a Alugar",
      icon: "key",
      tone: "blue" as const,
      description: "Locação e temporada.",
      count: rentCount,
    },
    {
      href: "/imoveis/vender",
      title: "Imóveis a Vender",
      icon: "banknote",
      tone: "accent" as const,
      description: "Imóveis à venda.",
      count: saleCount,
    },
  ];

  return (
    <>
      <PageHeader title="Imóveis" />
      <div className="grid grid-3">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="lookup-card reveal">
            <span className={`stat-icon ${c.tone}`}>
              <Icon name={c.icon} />
            </span>
            <div className="stack" style={{ gap: 4 }}>
              <span className="lookup-card-title">{c.title}</span>
              <span className="subtle text-sm">{c.description}</span>
            </div>
            <div className="lookup-card-foot">
              <span className="badge badge-slate">
                {c.count} {c.count === 1 ? "imóvel" : "imóveis"}
              </span>
              <span className="row gap-8 text-sm strong">
                Abrir <Icon name="arrowRight" size={15} />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
