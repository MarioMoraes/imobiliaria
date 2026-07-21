"use server";

import { fetchSearch, type SearchResults } from "../../lib/api";

/**
 * Busca global da barra do topo. É uma Server Action porque o cliente HTTP
 * (`lib/api`) roda só no servidor — é ele que injeta o token da sessão.
 */
export async function globalSearchAction(
  q: string,
): Promise<{ ok: boolean; results?: SearchResults; error?: string }> {
  const term = q.trim();
  if (term.length < 2) return { ok: true, results: undefined };
  const results = await fetchSearch(term);
  if (!results) return { ok: false, error: "Busca indisponível no momento." };
  return { ok: true, results };
}
