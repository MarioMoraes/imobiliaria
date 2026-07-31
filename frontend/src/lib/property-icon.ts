/**
 * Ícone que representa o TIPO do imóvel (Apartamento, Casa, Galpão…).
 *
 * O tipo é um cadastro do tenant (`property_types`), com nome livre — não há
 * enum para casar. Por isso o match é por palavra-chave sobre o nome
 * normalizado (minúsculo, sem acento), o que cobre tanto os tipos usuais quanto
 * os que a imobiliária inventar ("Apto Cobertura", "Área rural").
 *
 * Mora em `lib/` porque é usado tanto pela lista de Imóveis (Client Component)
 * quanto pelo painel (Server Component). Módulo puro de propósito: nada de
 * `lib/api.ts` aqui, que é `server-only` e quebraria o import do lado cliente.
 */
export function propertyTypeIcon(typeName: string | undefined): string {
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
