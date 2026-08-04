import Link from "next/link";
import { PageHeader } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { fetchContracts, fetchProperties, type Property } from "../../../lib/api";
import { sampleProperties } from "../../../lib/sample";

/**
 * Hub de Imóveis (padrão de /tabelas): as listas por finalidade — "Imóveis a
 * Alugar" (locação/temporada) e "Imóveis a Vender" — mais os Contratos, que
 * vivem aqui por serem o desfecho natural do imóvel. As duas primeiras são a
 * mesma entidade (`properties`), separada por `purpose`.
 */
export default async function ImoveisPage() {
  const [liveProps, liveContracts] = await Promise.all([fetchProperties(), fetchContracts()]);
  const properties: Property[] = liveProps ?? sampleProperties;
  const saleCount = properties.filter((p) => p.purpose === "sale").length;
  const rentCount = properties.length - saleCount;
  const contractCount = liveContracts?.length ?? 0;
  // Mesmo recorte do PDF (`listForRentalReport`): só o que está disponível —
  // alugado, reservado e inativo não entram. O card não pode prometer um
  // número que o relatório não mostra.
  const reportCount = properties.filter(
    (p) => p.purpose !== "sale" && p.status === "available",
  ).length;

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
      // Contagem real: com dado de exemplo aqui o card anunciava 4 contratos e a
      // lista abria com outro número.
      countLabel: `${contractCount} ${contractCount === 1 ? "contrato" : "contratos"}`,
    },
    {
      // Abre um PDF, não uma tela: o card vira `target="_blank"` e o arquivo
      // cai no visualizador do navegador (ver `imoveis/relatorio/route.ts`).
      href: "/imoveis/relatorio",
      title: "Relatório de Locação",
      icon: "printer",
      tone: "warning" as const,
      description: "Relação por bairro, em PDF.",
      countLabel: imoveis(reportCount),
      isFile: true,
    },
  ];

  return (
    <>
      <PageHeader title="Imóveis" />
      <div className="grid grid-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            // O card do relatório entrega um arquivo: em aba nova o PDF abre no
            // visualizador sem tirar o usuário do hub.
            {...(c.isFile ? { target: "_blank", rel: "noopener" } : {})}
            className="lookup-card reveal"
          >
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
                {c.isFile ? "Gerar" : "Abrir"}{" "}
                <Icon name={c.isFile ? "printer" : "arrowRight"} size={15} />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
