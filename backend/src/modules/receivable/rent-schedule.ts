import type { ScheduledInstallment } from "./receivable.schema.js";

/**
 * Cálculo das parcelas de aluguel de um contrato — função **pura** (sem banco,
 * sem tenant), para a regra poder ser testada sozinha.
 *
 * Regra: uma parcela por mês de vigência (`termMonths`), no valor do aluguel,
 * vencendo no "Dia Inq" (`tenantPayDay`) do contrato. Sem dia definido, cai no
 * dia do início da locação.
 */

/** Meses com menos dias que o dia de vencimento fecham no último dia (31 → 28/30). */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string {
  const clamped = Math.min(day, lastDayOfMonth(year, month));
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(clamped).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export interface RentScheduleInput {
  startsAt: string | null;
  endsAt: string | null;
  termMonths: number | null;
  tenantPayDay: number | null;
  rentalValueCents: number | null;
}

/**
 * Devolve as parcelas do contrato, ou `[]` quando faltam dados para calculá-las
 * (sem início, sem prazo ou sem valor). A ausência não é erro: o contrato pode
 * ser assinado incompleto e as parcelas serem geradas depois, quando o
 * financeiro preencher os campos.
 */
export function buildRentSchedule(contract: RentScheduleInput): ScheduledInstallment[] {
  const { startsAt, rentalValueCents } = contract;
  if (!startsAt || !rentalValueCents || rentalValueCents <= 0) return [];

  const total = installmentCount(contract);
  if (total <= 0) return [];

  const [y, m, d] = startsAt.split("-").map(Number) as [number, number, number];
  const payDay = contract.tenantPayDay ?? d;

  // A 1ª parcela vence no mês do início — a menos que o dia de pagamento já
  // tenha passado quando a locação começou; nesse caso, no mês seguinte.
  const firstMonthOffset = iso(y, m - 1, payDay) < startsAt ? 1 : 0;

  const installments: ScheduledInstallment[] = [];
  for (let i = 0; i < total; i++) {
    const ref = new Date(Date.UTC(y, m - 1 + firstMonthOffset + i, 1));
    const year = ref.getUTCFullYear();
    const month = ref.getUTCMonth();
    installments.push({
      competence: `${year}-${String(month + 1).padStart(2, "0")}`,
      installment: i + 1,
      installmentsTotal: total,
      amountCents: rentalValueCents,
      dueDate: iso(year, month, payDay),
      description: `Aluguel ${i + 1}/${total}`,
    });
  }
  return installments;
}

/** `termMonths` manda; sem ele, o número de meses entre início e vencimento. */
function installmentCount(contract: RentScheduleInput): number {
  if (contract.termMonths && contract.termMonths > 0) return contract.termMonths;
  if (!contract.startsAt || !contract.endsAt) return 0;

  const [sy, sm] = contract.startsAt.split("-").map(Number) as [number, number];
  const [ey, em] = contract.endsAt.split("-").map(Number) as [number, number];
  const months = (ey - sy) * 12 + (em - sm);
  return months > 0 ? months : 0;
}
