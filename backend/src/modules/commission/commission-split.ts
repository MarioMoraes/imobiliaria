import type { CommissionSplitEntry } from "./commission.schema.js";

/**
 * Divisão da comissão de uma venda — função **pura** (sem banco, sem tenant),
 * espelhando o papel de `payable/owner-payout.ts` do lado do repasse.
 *
 * Regra: sobre o valor da venda incide a comissão total (o que o cliente paga à
 * imobiliária). Dela sai a parte do corretor, calculada sobre a MESMA base — é
 * assim que a corretagem é contratada no mercado, e é o que `brokers.commission_percent`
 * representa. A imobiliária fica com a diferença.
 *
 * O resultado é **um lançamento por parte**: a entrada da imobiliária e a saída
 * do corretor. Não é cosmético — as duas quitam em datas diferentes (o cliente
 * paga no fechamento, o corretor recebe no acerto do mês), e o fluxo de caixa
 * precisa posicionar cada uma no seu dia.
 */

export interface CommissionSplitSource {
  /** Valor da venda — base dos dois percentuais. */
  saleValueCents: number;
  /** Comissão total cobrada do cliente, em % sobre a venda. */
  commissionPercent: number;
  /** Corretor que intermediou. Sem ele, a comissão inteira é da imobiliária. */
  broker: { id: string; commissionPercent: number } | null;
  /** Vencimento da parte da imobiliária (normalmente o fechamento da venda). */
  dueDate: string;
  /**
   * Vencimento da parte do corretor. Separado de propósito: o acerto com o
   * corretor costuma cair depois do recebimento do cliente.
   */
  brokerDueDate?: string;
  /** Identificação do imóvel na descrição (código ou título). */
  reference?: string | null;
}

/**
 * Devolve as partes, ou `[]` quando não há o que dividir (venda ou percentual
 * zerado). A ausência não é erro — mesma filosofia de `buildOwnerPayouts`: o
 * lançamento pode ser feito depois, à mão, quando o dado estiver completo.
 */
export function buildCommissionSplit(
  source: CommissionSplitSource,
): CommissionSplitEntry[] {
  const saleValueCents = nonNegative(source.saleValueCents);
  const commissionPercent = clampPercent(source.commissionPercent);
  if (saleValueCents <= 0 || commissionPercent <= 0) return [];

  const totalCents = Math.round((saleValueCents * commissionPercent) / 100);
  if (totalCents <= 0) return [];

  const brokerPercent = source.broker ? clampPercent(source.broker.commissionPercent) : 0;
  // Teto no total: um corretor cadastrado com percentual maior que a comissão
  // cobrada do cliente faria a imobiliária pagar do próprio bolso e a receita
  // ficar negativa. Trunca no total — o dado está sujo, não o cálculo.
  const brokerCents = source.broker
    ? Math.min(Math.round((saleValueCents * brokerPercent) / 100), totalCents)
    : 0;

  const entries: CommissionSplitEntry[] = [
    {
      party: "IMOBILIARIA",
      brokerId: null,
      baseCents: saleValueCents,
      percent: commissionPercent,
      // A imobiliária lança a comissão CHEIA que recebe do cliente. A parte do
      // corretor é uma saída à parte, não um desconto na entrada: é o que faz o
      // extrato bater e a margem aparecer.
      amountCents: totalCents,
      dueDate: source.dueDate,
      description: describe("Comissão de venda", source.reference),
    },
  ];

  if (source.broker && brokerCents > 0) {
    entries.push({
      party: "CORRETOR",
      brokerId: source.broker.id,
      baseCents: saleValueCents,
      percent: brokerPercent,
      amountCents: brokerCents,
      dueDate: source.brokerDueDate ?? source.dueDate,
      description: describe("Comissão de corretor", source.reference),
    });
  }

  return entries;
}

/** Percentual fora de 0..100 é dado sujo; trunca em vez de gerar valor negativo. */
function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, 100);
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function describe(label: string, reference?: string | null): string {
  return reference ? `${label} — ${reference}` : label;
}
