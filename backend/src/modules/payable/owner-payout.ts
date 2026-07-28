import { addMonths, isoDay, parseIsoDay } from "../../shared/month.js";
import type { OwnerPayout } from "./payable.schema.js";

/**
 * Cálculo do repasse ao proprietário — função **pura** (sem banco, sem tenant),
 * espelhando o papel de `receivable/rent-schedule.ts` do lado do inquilino.
 *
 * Regra: aluguel pago menos a taxa de administração. O líquido é rateado entre
 * os donos do imóvel por `share_percent`, e vence no mês seguinte ao pagamento,
 * no "Dia Prop" (`ownerPayDay`) do contrato.
 */

export interface PayoutOwner {
  personId: string;
  sharePercent: number;
}

export interface OwnerPayoutSource {
  receivableId: string;
  contractId: string | null;
  propertyId: string | null;
  competence: string | null;
  /**
   * Base do cálculo: o valor da PARCELA, não o valor recebido. Juros e multa de
   * atraso são receita da imobiliária pelo custo da cobrança — se entrassem
   * aqui, o dono lucraria com o próprio inadimplente e a taxa incidiria sobre
   * encargo, não sobre aluguel.
   */
  baseCents: number;
  /** Data da baixa — é dela que sai o "mês seguinte". */
  paidAt: string | null;
  adminFeePercent: number;
  ownerPayDay: number | null;
  owners: PayoutOwner[];
}

/**
 * Devolve um lançamento por dono, ou `[]` quando falta dado para calcular
 * (sem donos cadastrados, sem data de pagamento, base zerada). A ausência não é
 * erro — mesma filosofia de `buildRentSchedule`: o repasse pode ser gerado
 * depois, pela reconciliação, quando o cadastro estiver completo.
 */
export function buildOwnerPayouts(source: OwnerPayoutSource): OwnerPayout[] {
  const { baseCents, paidAt, owners } = source;
  if (!paidAt || baseCents <= 0 || owners.length === 0) return [];

  const feePercent = clampPercent(source.adminFeePercent);
  const feeTotal = Math.round((baseCents * feePercent) / 100);
  const dueDate = payoutDueDate(paidAt, source.ownerPayDay);

  // O rateio distribui por baixo e sobra centavo (60/40 de R$ 1.000,01, por
  // exemplo). Em vez de espalhar o erro, os N-1 primeiros recebem o valor
  // truncado e o ÚLTIMO leva o resto — assim `Σ bruto = base` e
  // `Σ taxa = feeTotal` fecham exatamente, e o total repassado bate com o
  // aluguel no centavo.
  const payouts: OwnerPayout[] = [];
  let grossAllocated = 0;
  let feeAllocated = 0;

  owners.forEach((owner, index) => {
    const last = index === owners.length - 1;
    const share = clampPercent(owner.sharePercent);

    const grossCents = last
      ? baseCents - grossAllocated
      : Math.floor((baseCents * share) / 100);
    const adminFeeCents = last
      ? feeTotal - feeAllocated
      : Math.floor((feeTotal * share) / 100);

    grossAllocated += grossCents;
    feeAllocated += adminFeeCents;

    payouts.push({
      payeePersonId: owner.personId,
      sharePercent: share,
      grossCents,
      adminFeePercent: feePercent,
      adminFeeCents,
      amountCents: grossCents - adminFeeCents,
      dueDate,
      competence: source.competence,
      description: describe(source.competence),
    });
  });

  return payouts;
}

/**
 * Mês seguinte ao PAGAMENTO (e não à competência): o repasse é pós-compensação,
 * então o que dispara o prazo é o dinheiro ter entrado. Um aluguel de julho pago
 * com atraso em agosto é repassado em setembro, não num vencimento que já passou.
 */
function payoutDueDate(paidAt: string, ownerPayDay: number | null): string {
  const [year, month, day] = parseIsoDay(paidAt);
  const [dueYear, dueMonth] = addMonths(year, month, 1);
  return isoDay(dueYear, dueMonth, ownerPayDay ?? day);
}

/** Percentual fora de 0..100 é dado sujo; trunca em vez de gerar valor negativo. */
function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, 100);
}

function describe(competence: string | null): string {
  return competence ? `Repasse aluguel ${competence}` : "Repasse de aluguel";
}
