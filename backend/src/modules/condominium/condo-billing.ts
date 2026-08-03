import type { Property } from "../property/property.schema.js";
import type { CondoBillingLine } from "./condominium.schema.js";

/**
 * Cálculo da cobrança de condomínio de um período. Função pura — sem I/O, sem
 * banco: recebe os imóveis do condomínio, quem é o locatário de cada um e o
 * total de despesas lançadas no período, e devolve uma linha por imóvel.
 *
 * Regra do valor: `rateio das despesas` + `valor do condomínio × meses do período`.
 */

/** Locatário do contrato ativo de um imóvel (vindo do módulo de contrato). */
export interface ActiveTenant {
  personId: string;
  personName: string;
}

export interface BuildCondoBillingInput {
  properties: Property[];
  /** propertyId → locatário do contrato VIGENTE/RENOVADO, quando existe. */
  tenantByProperty: Map<string, ActiveTenant>;
  expensesTotalCents: number;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  /** Imóveis que já têm cobrança nesta competência (não serão gerados de novo). */
  billedPropertyIds: Set<string>;
}

/**
 * Meses-calendário tocados pelo período, inclusive nas pontas. 01/03→31/05 = 3;
 * 15/03→10/04 = 2. Contamos meses tocados (e não dias/30) porque o valor do
 * condomínio é mensal: um período que encosta em abril cobra abril inteiro.
 */
export function monthsInPeriod(periodStart: string, periodEnd: string): number {
  const [ys, ms] = periodStart.split("-").map(Number) as [number, number];
  const [ye, me] = periodEnd.split("-").map(Number) as [number, number];
  return (ye * 12 + me) - (ys * 12 + ms) + 1;
}

/** Competência da cobrança: o mês em que o período começa (YYYY-MM). */
export function competenceOf(periodStart: string): string {
  return periodStart.slice(0, 7);
}

/**
 * Rateio igual do total entre `count` unidades. O resto em centavos vai todo
 * para a primeira unidade: sem isso a soma das linhas ficava abaixo do total
 * lançado (R$ 100,00 entre 3 unidades viraria R$ 99,99 cobrados).
 */
function splitEqually(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalCents / count);
  const shares = Array.from({ length: count }, () => base);
  shares[0] = base + (totalCents - base * count);
  return shares;
}

/** Endereço do imóvel para a coluna da tela; cai no título quando não há rua. */
function addressOf(p: Property): string {
  const line = [p.address, p.number].filter(Boolean).join(", ");
  return line || p.title;
}

/**
 * Proprietário que recebe a cobrança quando o imóvel não está locado: o de
 * maior participação. Empate mantém a ordem que vem do repositório (nome
 * crescente), então o resultado é estável entre execuções.
 */
function mainOwner(p: Property): { personId: string; personName: string } | null {
  let best: Property["owners"][number] | null = null;
  for (const owner of p.owners) {
    if (!best || owner.sharePercent > best.sharePercent) best = owner;
  }
  return best ? { personId: best.personId, personName: best.personName } : null;
}

export function buildCondoBilling(input: BuildCondoBillingInput): CondoBillingLine[] {
  const {
    properties,
    tenantByProperty,
    expensesTotalCents,
    periodStart,
    periodEnd,
    billedPropertyIds,
  } = input;

  const months = monthsInPeriod(periodStart, periodEnd);
  // O rateio divide entre TODAS as unidades do condomínio — inclusive as sem
  // pagador definido. Excluí-las inflaria a conta de quem tem pagador por um
  // cadastro incompleto, que é problema do cadastro, não do condômino.
  const shares = splitEqually(expensesTotalCents, properties.length);

  return properties.map((p, i) => {
    const active = tenantByProperty.get(p.id);
    const owner = active ? null : mainOwner(p);

    const condoFeeCents = p.condoFeeCents ?? 0;
    const condoTotalCents = condoFeeCents * months;
    const expenseShareCents = shares[i] ?? 0;

    return {
      propertyId: p.id,
      propertyCode: p.code,
      propertyAddress: addressOf(p),
      payerKind: active ? "LOCATARIO" : owner ? "LOCADOR" : null,
      payerPersonId: active?.personId ?? owner?.personId ?? null,
      payerName: active?.personName ?? owner?.personName ?? null,
      months,
      condoFeeCents,
      condoTotalCents,
      expenseShareCents,
      totalCents: condoTotalCents + expenseShareCents,
      alreadyBilled: billedPropertyIds.has(p.id),
    };
  });
}
