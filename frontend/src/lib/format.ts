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

/**
 * Domínio da plataforma: o slug do tenant é o subdomínio dele
 * (`<slug>.officestecnologia.com.br`). Só o slug é editável — o domínio é fixo.
 */
export const TENANT_DOMAIN = "officestecnologia.com.br";

/** Slug do tenant → subdomínio completo. Sem slug, travessão. */
export function tenantSubdomain(slug: string | null | undefined): string {
  return slug ? `${slug}.${TENANT_DOMAIN}` : "—";
}

/** Centavos → "R$ 1.234,56". `null` vira travessão. Sempre 2 casas (padrão BRL). */
export function formatPrice(cents: number | null): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/**
 * "2026-08" → "Agosto/2026".
 *
 * Escrito à mão e não por `toLocaleDateString`: o pt-BR devolve "agosto de
 * 2026" — minúsculo e por extenso — e o painel usa a forma capitalizada com
 * barra. Sem `new Date()` no meio, porque YYYY-MM não tem fuso.
 */
export function formatMonth(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  const name = MONTH_NAMES[index];
  return name ? `${name}/${month.slice(0, 4)}` : month;
}

/** "YYYY-MM-DD" → "dd/mm/aaaa". Sem passar por Date, para não mudar de fuso. */
export function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
