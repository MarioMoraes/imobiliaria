import { z } from "zod";

/**
 * Busca global (barra do topo). O resultado é **normalizado**: quem consome não
 * precisa saber o formato de imóvel, pessoa ou contrato — só desenhar a linha e
 * seguir o `href`.
 */

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, "Informe ao menos 2 caracteres").max(120),
  /** Resultados por tipo (não no total). */
  limit: z.coerce.number().int().min(1).max(10).default(5),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export type SearchKind = "imovel" | "pessoa" | "contrato";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  /** Linha principal (título do imóvel, nome da pessoa, "Contrato Nº 12"). */
  label: string;
  /** Linha de apoio (endereço, CPF, situação…). */
  sub: string | null;
  /** Destino no app, já com o termo para a lista filtrar. */
  href: string;
}

export interface SearchResults {
  imoveis: SearchHit[];
  pessoas: SearchHit[];
  contratos: SearchHit[];
  total: number;
}
