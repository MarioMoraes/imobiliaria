/**
 * Filtro de listas por termo livre — o mesmo que a busca global manda na URL
 * (`?q=`). Puro e sem dependência de servidor, para poder ser usado tanto pelas
 * páginas (Server Components) quanto por componentes client.
 */

/** Minúsculas sem acento, para "Joao" achar "João". */
export const fold = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * `true` se qualquer campo contém o termo. Números viram texto (código do
 * imóvel/contrato) e valores vazios são ignorados. Sem termo, não filtra nada —
 * quem chama pode passar o `q` direto da URL.
 */
export function matches(
  term: string | undefined,
  ...fields: (string | number | null | undefined)[]
): boolean {
  const needle = fold((term ?? "").trim());
  if (!needle) return true;

  // Termo só com dígitos também casa com documento/telefone formatados.
  const digits = needle.replace(/\D/g, "");

  return fields.some((f) => {
    if (f === null || f === undefined) return false;
    const value = fold(String(f));
    if (value.includes(needle)) return true;
    if (!digits) return false;
    const valueDigits = value.replace(/\D/g, "");
    return valueDigits !== "" && valueDigits.includes(digits);
  });
}

/** Lê o `q` de `searchParams` (Next 15 entrega como Promise). */
export async function readQuery(
  searchParams?: Promise<{ q?: string | string[] }>,
): Promise<string> {
  const params = await searchParams;
  const q = params?.q;
  return (Array.isArray(q) ? q[0] : q)?.trim() ?? "";
}
