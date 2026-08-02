import { z } from "zod";

/**
 * Ciclo de vida de uma conta a pagar.
 *
 * `PROCESSANDO` não existe em `receivables` e é o estado próprio da saída: a
 * transferência PIX do Asaas é assíncrona (responde PENDING e só depois manda
 * TRANSFER_DONE). Marcar PAGO na criação diria que o proprietário recebeu um
 * dinheiro ainda em trânsito — e uma falha depois deixaria o caixa mentindo.
 */
export const payableStatus = z.enum([
  "ABERTO",
  "PROCESSANDO",
  "PAGO",
  "VENCIDO",
  "CANCELADO",
  "ESTORNADO",
]);

/** Natureza do lançamento. Hoje só REPASSE é gerado automaticamente. */
export const payableKind = z.enum(["REPASSE", "OUTRO"]);

/** Mesmo teto de `receivable.schema.ts`: BIGINT lido com Number() precisa caber em 2^53. */
const cents = z.number().int().nonnegative().max(100_000_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (YYYY-MM-DD)");
const competence = z.string().regex(/^\d{4}-\d{2}$/, "Competência inválida (YYYY-MM)");

/** Lançamento avulso (despesa lançada à mão pelo financeiro). */
export const createPayableSchema = z.object({
  contractId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  payeePersonId: z.string().uuid(),
  kind: payableKind.default("OUTRO"),
  description: z.string().max(200).optional(),
  competence: competence.optional(),
  amountCents: cents,
  dueDate: isoDate,
});
export type CreatePayableInput = z.infer<typeof createPayableSchema>;

/**
 * Edição vinda do cliente. Como em `receivables`, os campos de ciclo de vida
 * (`status`, `paidAt`, `paidAmountCents`) ficam FORA: quem os move é `settle` /
 * `cancel`, que conhecem as transições válidas. Os valores apurados
 * (`grossCents`, `adminFeeCents`) também não se editam — são o resultado do
 * cálculo sobre o aluguel, e mexer neles à mão desalinharia o repasse da receita.
 */
export const updatePayableSchema = z
  .object({
    description: z.string().max(200).nullable().optional(),
    amountCents: cents.optional(),
    dueDate: isoDate.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdatePayableInput = z.infer<typeof updatePayableSchema>;

/** Campos de ciclo de vida — INTERNO, montado só pelo service. */
export interface PayableStateChange {
  status?: z.infer<typeof payableStatus>;
  paidAt?: string | null;
  paidAmountCents?: number | null;
  transferStatus?: string | null;
  transferFailedReason?: string | null;
}

export type PatchPayableInput = UpdatePayableInput & PayableStateChange;

/** Baixa do repasse. Sem valor informado, quita o líquido do lançamento. */
export const settlePayableSchema = z.object({
  paidAt: isoDate.optional(),
  paidAmountCents: cents.optional(),
});
export type SettlePayableInput = z.infer<typeof settlePayableSchema>;

/** Filtros da listagem (todos opcionais e combináveis). */
export const listPayablesQuerySchema = z.object({
  contractId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  payeePersonId: z.string().uuid().optional(),
  status: payableStatus.optional(),
  kind: payableKind.optional(),
  /** Competência do aluguel que originou o repasse. */
  competence: competence.optional(),
  /**
   * Mês de VENCIMENTO (YYYY-MM) — é por ele que a tela filtra. O repasse vence
   * no mês seguinte ao pagamento do aluguel, então "o que pago em agosto" e "os
   * aluguéis de agosto" são conjuntos diferentes; quem opera quer o primeiro.
   */
  dueMonth: competence.optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListPayablesQuery = z.infer<typeof listPayablesQuerySchema>;

/** Janela do resumo: um mês de referência (default = mês corrente no service). */
export const payableSummaryQuerySchema = z.object({
  month: competence.optional(),
});
export type PayableSummaryQuery = z.infer<typeof payableSummaryQuerySchema>;

/**
 * Um conjunto de lançamentos escolhido na tela — base do recibo e do PIX único.
 *
 * `ids` chega como CSV (`?ids=a,b,c`) para caber numa URL de `<a>`, que é como o
 * PDF é aberto. O teto de 50 é o mesmo espírito do `limit` da listagem: protege
 * de uma URL absurda sem atrapalhar o uso real (um proprietário com 50 imóveis
 * já é caso raro).
 */
export const payableSelectionSchema = z.object({
  ids: z
    .string()
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1).max(50)),
});
export type PayableSelection = z.infer<typeof payableSelectionSchema>;

/** Mesma seleção vinda de um POST (corpo JSON), para o PIX único. */
export const payableIdsSchema = z.object({
  payableIds: z.array(z.string().uuid()).min(1).max(50),
});
export type PayableIdsInput = z.infer<typeof payableIdsSchema>;

/**
 * Indicadores do mês, agregados no banco.
 *
 * Somar a listagem no cliente não serve: ela tem limite (500), e a partir daí os
 * cards passariam a mentir em silêncio conforme a carteira crescesse — o mesmo
 * motivo documentado em `receivable.service.cashFlow`.
 */
export interface PayableSummary {
  /** YYYY-MM de referência. */
  month: string;
  /** Repasses em aberto que vencem no mês. */
  openCents: number;
  /** Repasses efetivamente pagos no mês (pela data da baixa). */
  paidCents: number;
  /** Em aberto com vencimento já passado. */
  overdueCents: number;
  overdueCount: number;
  /** Receita da imobiliária: taxa de administração apurada no mês. */
  adminFeeCents: number;
  /** Quantos lançamentos em aberto existem no total (badge do card). */
  pendingCount: number;
}

export interface Payable {
  id: string;
  tenantId: string;
  contractId: string | null;
  propertyId: string | null;
  receivableId: string | null;
  payeePersonId: string;
  /** Nome do proprietário (LEFT JOIN persons) — a listagem precisa dele. */
  payeeName: string | null;
  /** Código do imóvel (sequencial por tenant), não o UUID nem o título. */
  propertyCode: number | null;
  kind: string;
  description: string | null;
  competence: string | null;
  sharePercent: number;
  grossCents: number;
  adminFeePercent: number;
  adminFeeCents: number;
  amountCents: number;
  dueDate: string;
  status: string;
  paidAt: string | null;
  paidAmountCents: number | null;

  /** Transferência PIX no Asaas. Nulos enquanto o repasse não foi enviado. */
  asaasTransferId: string | null;
  /** Estado bruto do provedor (PENDING|BANK_PROCESSING|DONE|FAILED|CANCELLED). */
  transferStatus: string | null;
  /** Motivo da recusa, quando a transferência falha. */
  transferFailedReason: string | null;

  createdAt: string;
  updatedAt: string;
}

/** Um repasse pronto para inserção (saída de `buildOwnerPayouts`). */
export interface OwnerPayout {
  payeePersonId: string;
  sharePercent: number;
  grossCents: number;
  adminFeePercent: number;
  adminFeeCents: number;
  amountCents: number;
  dueDate: string;
  competence: string | null;
  description: string;
}
