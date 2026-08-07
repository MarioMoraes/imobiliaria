import { z } from "zod";

/**
 * Período livre (`de`/`até`) — o recorte dos relatórios do financeiro.
 *
 * Os demais recortes do módulo são de MÊS (`YYYY-MM`), porque a operação é
 * mensal: competência, vencimento do repasse, extrato do fluxo. Relatório é
 * outra coisa — quem fecha o trimestre, o exercício ou a quinzena precisa
 * escolher os dois extremos, e um seletor de mês obrigaria a emitir três
 * documentos e somar à mão.
 *
 * As datas viajam como string `YYYY-MM-DD` e NUNCA passam por `Date` local (ver
 * `shared/month.ts`): meia-noite de "2026-08-01" em UTC-3 é 31/07, e o
 * relatório perderia (ou ganharia) o primeiro dia do período conforme o fuso do
 * servidor.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (YYYY-MM-DD)");

export const periodQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((p) => p.from <= p.to, {
    message: "A data inicial não pode ser maior que a final",
    path: ["from"],
  });
export type Period = z.infer<typeof periodQuerySchema>;

/**
 * Fim EXCLUSIVO do período, para as janelas `[início, fim)` do SQL.
 *
 * O usuário informa um período fechado dos dois lados ("de 01/08 a 31/08"), mas
 * comparar `<= $2` com uma coluna `timestamptz` deixaria de fora tudo o que
 * aconteceu depois de 00:00 do último dia. Meio-aberto com o dia seguinte pega
 * o dia inteiro e serve igual para `date` e para `timestamptz`.
 */
export function exclusiveEnd(to: string): string {
  const [y, m, d] = to.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${next.getUTCFullYear()}-${mm}-${dd}`;
}

/** "2026-08-01".."2026-08-31" → "01/08/2026 a 31/08/2026". */
export function periodLabel(period: Period): string {
  return `${dayLabel(period.from)} a ${dayLabel(period.to)}`;
}

/** "2026-08-10" → "10/08/2026". Sem passar por `Date` (evita fuso). */
export function dayLabel(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** "2026-08" → "ago/2026" — cabeçalho das quebras por mês. */
export function monthLabel(month: string): string {
  const abbr = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];
  return `${abbr[Number(month.slice(5, 7)) - 1] ?? month}/${month.slice(0, 4)}`;
}
