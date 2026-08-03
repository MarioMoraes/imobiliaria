/**
 * Apresentação da cobrança de condomínio — puro, sem dependência de servidor,
 * para poder ser importado tanto pela página (Server Component) quanto pelo
 * painel (Client Component).
 */

/**
 * Papéis que podem gerar a cobrança — espelha `finance:write` da matriz do
 * backend (`modules/rbac/permissions.ts`). Mora aqui para que o card da landing
 * e a guarda da subpágina usem a MESMA lista: duas cópias soltas viram duas
 * respostas diferentes na primeira vez que a regra mudar.
 */
export const BILLING_ROLES = ["SUPER_ADMIN", "ADMIN", "FINANCEIRO"];

/** Rótulo de quem paga a conta gerada. */
export function payerLabel(kind: "LOCATARIO" | "LOCADOR" | null): string {
  if (kind === "LOCATARIO") return "Inquilino";
  if (kind === "LOCADOR") return "Proprietário";
  return "Sem pagador";
}

/** Selo de quem paga: inquilino em verde, proprietário em azul, falta em âmbar. */
export function payerTone(kind: "LOCATARIO" | "LOCADOR" | null): string {
  if (kind === "LOCATARIO") return "badge-green";
  if (kind === "LOCADOR") return "badge-blue";
  return "badge-amber";
}

/** Primeiro dia do mês corrente, em YYYY-MM-DD (valor inicial do período). */
export function firstDayOfMonth(today = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Último dia do mês da data informada, em YYYY-MM-DD. */
export function lastDayOfMonth(today = new Date()): string {
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(
    end.getDate(),
  ).padStart(2, "0")}`;
}
