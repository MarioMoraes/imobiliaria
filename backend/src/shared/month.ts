/**
 * Aritmética de mês para datas de negócio (vencimentos).
 *
 * Datas de negócio viajam como string `YYYY-MM-DD` (ver `setTypeParser` em
 * `db.ts`) justamente para não passarem por `Date` local e escorregarem um dia
 * por fuso. Estes helpers mantêm essa disciplina: entram e saem strings, e o
 * `Date` só é usado em UTC, para descobrir o tamanho do mês.
 *
 * Compartilhado entre o vencimento do inquilino (`receivable/rent-schedule.ts`)
 * e o do proprietário (`payable/owner-payout.ts`) — a regra do "dia 31 em mês
 * de 30" tem que ser a mesma dos dois lados.
 */

/** Meses com menos dias que o dia de vencimento fecham no último dia (31 → 28/30). */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** `month` é 0-based (como no `Date`). O dia é limitado ao tamanho do mês. */
export function isoDay(year: number, month: number, day: number): string {
  const clamped = Math.min(day, lastDayOfMonth(year, month));
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(clamped).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** `YYYY-MM-DD` → `[ano, mês 0-based, dia]`. */
export function parseIsoDay(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return [y, m - 1, d];
}

/**
 * Desloca `months` meses a partir de um mês qualquer e devolve a data no dia
 * pedido. Usa `Date.UTC` com dia 1 para o vai-e-vem de ano acontecer sozinho
 * (dezembro + 1 = janeiro do ano seguinte).
 */
export function addMonths(
  year: number,
  month: number,
  months: number,
): [number, number] {
  const ref = new Date(Date.UTC(year, month + months, 1));
  return [ref.getUTCFullYear(), ref.getUTCMonth()];
}
