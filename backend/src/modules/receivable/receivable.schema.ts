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

/**
 * Valor monetário em centavos (não-negativo).
 *
 * O teto não é burocracia: a coluna é BIGINT, então um valor como 9e18 era
 * aceito e gravado, e a leitura faz `Number(...)` — acima de 2^53 a precisão se
 * perde em silêncio e os totais do dashboard e do fluxo de caixa passam a
 * mentir. R$ 1 bilhão em centavos é folgado para imóvel, aluguel e despesa, e
 * mantém tudo dentro do inteiro seguro do JavaScript.
 */
const cents = z.number().int().nonnegative().max(100_000_000_000);
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
 * Atualização parcial vinda do cliente. O valor e o vencimento das parcelas
 * geradas continuam editáveis (acordo, carência) — o que não se edita é a origem
 * (contrato).
 *
 * `status`, `paidAt` e `paidAmountCents` ficam FORA de propósito: são estado do
 * ciclo de vida, e só as operações que conhecem a regra podem mudá-los
 * (`settle`, o webhook do provedor). Quando estavam aqui, um PATCH marcava a
 * parcela como `PAGO` sem valor nenhum, contornando as guardas do `settle` (não
 * baixar conta cancelada, idempotência) e sem qualquer validação de transição.
 * Mesmo padrão já adotado em contrato/imóvel: campo de ciclo de vida não viaja
 * no payload de edição.
 */
export const updateReceivableSchema = z
  .object({
    description: z.string().max(200).nullable().optional(),
    amountCents: cents.optional(),
    dueDate: isoDate.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdateReceivableInput = z.infer<typeof updateReceivableSchema>;

/**
 * Campos de ciclo de vida — INTERNO. Não há schema zod porque isto nunca vem de
 * um corpo de request: só o service monta, a partir de `settle`/`cancel`/webhook.
 */
export interface ReceivableStateChange {
  status?: z.infer<typeof receivableStatus>;
  paidAt?: string | null;
  paidAmountCents?: number | null;
}

/** O que o repositório aceita: edição do cliente + transição de estado interna. */
export type PatchReceivableInput = UpdateReceivableInput & ReceivableStateChange;

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
  /** Mês de referência (YYYY-MM) — ver `listReceivables` no repositório. */
  competence: competence.optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListReceivablesQuery = z.infer<typeof listReceivablesQuerySchema>;

/** Janela do fluxo de caixa (meses para trás, incluindo o corrente). */
export const cashFlowQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
});
export type CashFlowQuery = z.infer<typeof cashFlowQuerySchema>;

/**
 * Um mês do fluxo de caixa. `received` é caixa de verdade (baixa dada, contada
 * pela data do pagamento); `expected` é o que vencia no mês, independente de ter
 * sido pago — a diferença entre os dois é a inadimplência daquela competência.
 */
export interface CashFlowPoint {
  /** YYYY-MM. */
  month: string;
  receivedCents: number;
  expectedCents: number;
}

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
