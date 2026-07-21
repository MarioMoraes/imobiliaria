import { z } from "zod";

/** Ciclo de vida de uma conta a receber (financeiro_11 §6). */
export const receivableStatus = z.enum([
  "ABERTO",
  "PAGO",
  "VENCIDO",
  "CANCELADO",
  "ESTORNADO",
]);

/** Natureza da cobrança. Hoje só ALUGUEL é gerado automaticamente. */
export const receivableKind = z.enum([
  "ALUGUEL",
  "IPTU",
  "CONDOMINIO",
  "MULTA",
  "OUTRO",
]);

const cents = z.number().int().nonnegative();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (YYYY-MM-DD)");
const competence = z.string().regex(/^\d{4}-\d{2}$/, "Competência inválida (YYYY-MM)");

/** Cobrança avulsa (lançada à mão pelo financeiro). */
export const createReceivableSchema = z.object({
  contractId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  payerPersonId: z.string().uuid().optional(),
  kind: receivableKind.default("OUTRO"),
  description: z.string().max(200).optional(),
  competence: competence.optional(),
  amountCents: cents,
  dueDate: isoDate,
});
export type CreateReceivableInput = z.infer<typeof createReceivableSchema>;

/**
 * Atualização parcial. O valor e o vencimento das parcelas geradas continuam
 * editáveis (acordo, carência) — o que não se edita é a origem (contrato).
 */
export const updateReceivableSchema = z
  .object({
    description: z.string().max(200).nullable().optional(),
    amountCents: cents.optional(),
    dueDate: isoDate.optional(),
    status: receivableStatus.optional(),
    paidAt: isoDate.nullable().optional(),
    paidAmountCents: cents.nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdateReceivableInput = z.infer<typeof updateReceivableSchema>;

/** Baixa de pagamento. Sem valor informado, quita o total da parcela. */
export const settleReceivableSchema = z.object({
  paidAt: isoDate.optional(),
  paidAmountCents: cents.optional(),
});
export type SettleReceivableInput = z.infer<typeof settleReceivableSchema>;

/** Filtros da listagem (todos opcionais e combináveis). */
export const listReceivablesQuerySchema = z.object({
  contractId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  status: receivableStatus.optional(),
  kind: receivableKind.optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListReceivablesQuery = z.infer<typeof listReceivablesQuerySchema>;

export interface Receivable {
  id: string;
  tenantId: string;
  contractId: string | null;
  propertyId: string | null;
  payerPersonId: string | null;
  payerName: string | null;
  kind: string;
  description: string | null;
  competence: string | null;
  installment: number | null;
  installmentsTotal: number | null;
  amountCents: number;
  dueDate: string;
  status: string;
  paidAt: string | null;
  paidAmountCents: number | null;

  /**
   * Cobrança bancária no provedor (Asaas). Nulos enquanto a conta do tenant não
   * está conectada — o boleto registrado (com código de barras válido) é emitido
   * pelo provedor, nunca por nós.
   */
  asaasChargeId: string | null;
  /** PDF do boleto no Asaas (`bankSlipUrl`) — é o que o botão "Boleto" abre. */
  boletoUrl: string | null;
  /** Fatura/link de pagamento (`invoiceUrl`) — PIX, cartão, etc. */
  invoiceUrl: string | null;

  createdAt: string;
  updatedAt: string;
}

/** Uma parcela pronta para inserção (saída de `buildRentSchedule`). */
export interface ScheduledInstallment {
  competence: string;
  installment: number;
  installmentsTotal: number;
  amountCents: number;
  dueDate: string;
  description: string;
}
