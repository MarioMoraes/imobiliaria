import Link from "next/link";
import { PageHeader } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { fetchProperties, type Property } from "../../../lib/api";
import { sampleContracts, sampleProperties } from "../../../lib/sample";

/**
 * Hub de Imóveis (padrão de /tabelas): as listas por finalidade — "Imóveis a
 * Alugar" (locação/temporada) e "Imóveis a Vender" — mais os Contratos, que
 * vivem aqui por serem o desfecho natural do imóvel. As duas primeiras são a
 * mesma entidade (`properties`), separada por `purpose`.
 */
export default async function ImoveisPage() {
  const liveProps = await fetchProperties();
  const properties: Property[] = liveProps ?? sampleProperties;
  const saleCount = properties.filter((p) => p.purpose === "sale").length;
  const rentCount = properties.length - saleCount;

  const imoveis = (n: number) => `${n} ${n === 1 ? "imóvel" : "imóveis"}`;

  const cards = [
    {
      href: "/imoveis/alugar",
      title: "Imóveis a Alugar",
      icon: "key",
      tone: "blue" as const,
      description: "Locação e temporada.",
      countLabel: imoveis(rentCount),
    },
    {
      href: "/imoveis/vender",
      title: "Imóveis a Vender",
      icon: "banknote",
      tone: "accent" as const,
      description: "Imóveis à venda.",
      countLabel: imoveis(saleCount),
    },
    {
      href: "/contratos",
      title: "Contratos",
      icon: "contract",
      tone: "success" as const,
      description: "Contratos de locação e venda.",
      countLabel: `${sampleContracts.length} contratos`,
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
              <span className="badge badge-slate">{c.countLabel}</span>
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
