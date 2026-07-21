/**
 * Formatadores de exibição — puros, **sem dependência de servidor**.
 *
 * Vivem fora de `api.ts` de propósito: aquele módulo importa o Clerk server
 * (`server-only`) e não pode ser carregado por um Client Component. Importar
 * `formatPrice` de lá arrastava o cliente HTTP inteiro para o bundle do
 * browser e quebrava o build com "'server-only' cannot be imported from a
 * Client Component". `api.ts` reexporta estes helpers, então os Server
 * Components existentes continuam importando de onde já importavam.
 */

/** Centavos → "R$ 1.234". `null` vira travessão. */
export function formatPrice(cents: number | null): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

/** ISO (timestamp) → "21 de jul. de 2026". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "YYYY-MM-DD" → "dd/mm/aaaa". Sem passar por Date, para não mudar de fuso. */
export function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
