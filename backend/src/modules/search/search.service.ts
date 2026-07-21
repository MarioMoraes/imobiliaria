import * as contractService from "../contract/contract.service.js";
import * as personService from "../person/person.service.js";
import * as propertyService from "../property/property.service.js";
import type { SearchHit, SearchResults } from "./search.schema.js";

/**
 * Busca global. Este módulo **compõe** os services públicos de imóvel, pessoa e
 * contrato — não tem tabela nem repositório próprio, e por isso não fura a
 * fronteira de nenhum módulo (cada um sabe buscar dentro do que é seu).
 *
 * Acrescentar um domínio à busca = expor um `search()` no service dele e somar
 * mais uma entrada aqui.
 */

const ROLE_LABEL: Record<string, string> = {
  LOCADOR: "Locador",
  LOCATARIO: "Locatário",
  FIADOR: "Fiador",
  COMPRADOR: "Comprador",
};

const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: "Rascunho",
  EM_ASSINATURA: "Em assinatura",
  VIGENTE: "Vigente",
  RENOVADO: "Renovado",
  ENCERRADO: "Encerrado",
  DISTRATADO: "Distratado",
};

/** O termo viaja na URL para a lista de destino já chegar filtrada. */
const withQuery = (path: string, term: string): string =>
  `${path}?q=${encodeURIComponent(term)}`;

/**
 * A pessoa é listada na tela do seu papel principal — quem é fiador aparece em
 * /fiadores, e assim por diante. Sem papel, cai em Locatários (a tela geral).
 */
function personHref(roles: string[], term: string): string {
  if (roles.includes("FIADOR")) return withQuery("/fiadores", term);
  if (roles.includes("LOCADOR")) return withQuery("/proprietarios", term);
  return withQuery("/clientes", term);
}

export async function search(
  tenantId: string,
  term: string,
  limit: number,
): Promise<SearchResults> {
  // Em paralelo: são três consultas independentes e a barra global precisa
  // responder enquanto o usuário ainda digita.
  const [properties, persons, contracts] = await Promise.all([
    propertyService.search(tenantId, term, limit),
    personService.search(tenantId, term, limit),
    contractService.search(tenantId, term, limit),
  ]);

  const imoveis: SearchHit[] = properties.map((p) => ({
    kind: "imovel",
    id: p.id,
    label: p.title,
    sub: [p.address, p.district, p.city].filter(Boolean).join(", ") || null,
    // Venda e locação vivem em listas separadas.
    href: withQuery(p.purpose === "sale" ? "/imoveis/vender" : "/imoveis/alugar", term),
  }));

  const pessoas: SearchHit[] = persons.map((p) => ({
    kind: "pessoa",
    id: p.id,
    label: p.fullName,
    sub:
      [p.roles.map((r) => ROLE_LABEL[r] ?? r).join(" · "), p.cpfCnpj, p.mobile ?? p.phone]
        .filter(Boolean)
        .join(" — ") || null,
    href: personHref(p.roles, term),
  }));

  const contratos: SearchHit[] = contracts.map((c) => ({
    kind: "contrato",
    id: c.id,
    label: c.code != null ? `Contrato Nº ${c.code}` : "Contrato",
    sub:
      [
        STATUS_LABEL[c.status] ?? c.status,
        c.parties.find((party) => party.role === "LOCATARIO")?.personName,
      ]
        .filter(Boolean)
        .join(" — ") || null,
    href: withQuery("/contratos", term),
  }));

  return {
    imoveis,
    pessoas,
    contratos,
    total: imoveis.length + pessoas.length + contratos.length,
  };
}
