import { z } from "zod";

/**
 * Fluxo de caixa (MOD-FIN / financeiro_11 §4).
 *
 * O ponto central do desenho está nas duas flags de cada movimento —
 * `affectsCash` e `affectsResult`. A taxa de administração **já está dentro** do
 * aluguel recebido: ela é a diferença entre o que o inquilino pagou e o que o
 * proprietário recebe. Lançá-la como uma terceira entrada de caixa somaria o
 * mesmo dinheiro duas vezes e o extrato do banco nunca fecharia.
 *
 * Então a tela mostra DOIS totais, e cada movimento declara de quais participa:
 *
 * - **Saldo de caixa** (`affectsCash`) — o extrato: entrou o aluguel inteiro,
 *   saiu o repasse inteiro. Inclui dinheiro de terceiros em trânsito.
 * - **Resultado da imobiliária** (`affectsResult`) — o que sobra de fato: taxa
 *   de administração, juros e multa, comissões e despesas próprias.
 *
 * Os dois reconciliam: o retido do aluguel (recebido − repassado) é exatamente
 * `taxa + juros e multa`, porque o repasse é calculado sobre o valor da parcela
 * e não sobre o pago (ver `payable/owner-payout.ts`). Quando divergem é por
 * tempo — aluguel recebido num mês e repassado no seguinte —, e é justamente o
 * que o indicador "a repassar" mede.
 */

export const cashFlowDirection = z.enum(["ENTRADA", "SAIDA"]);
export type CashFlowDirection = z.infer<typeof cashFlowDirection>;

/** De onde o movimento veio. Governa o rótulo e o link da linha na tela. */
export const cashFlowSource = z.enum([
  "RECEBIMENTO", // receivables PAGO — aluguel/condomínio/IPTU recebido
  "TAXA_ADM", // payables.admin_fee_cents — receita da administração
  "JUROS_MULTA", // receivables: pago − devido
  "REPASSE", // payables PAGO — saída ao proprietário
  "COMISSAO", // commissions QUITADO
  "MANUAL", // cash_flow_entries
]);
export type CashFlowSource = z.infer<typeof cashFlowSource>;

const cents = z.number().int().nonnegative().max(100_000_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (YYYY-MM-DD)");
const month = z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido (YYYY-MM)");

/* ------------------------------------------------------- Extrato do mês */

export const cashFlowQuerySchema = z.object({
  month: month.optional(),
});
export type CashFlowStatementQuery = z.infer<typeof cashFlowQuerySchema>;

export const cashFlowSeriesQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
});
export type CashFlowSeriesQuery = z.infer<typeof cashFlowSeriesQuerySchema>;

/** Uma linha do extrato — venha ela de tabela própria ou de agregação. */
export interface CashFlowMovement {
  /** `<origem>:<id>` — as origens derivadas não têm PK própria no extrato. */
  key: string;
  date: string;
  source: CashFlowSource;
  direction: CashFlowDirection;
  /** Rótulo curto da natureza ("Aluguel recebido", "Taxa de administração"). */
  label: string;
  /** Detalhe livre (pessoa, imóvel, competência). */
  description: string | null;
  amountCents: number;
  /** Entra no extrato bancário. */
  affectsCash: boolean;
  /** Entra no resultado da imobiliária. */
  affectsResult: boolean;
  /** Categoria do lançamento manual; nulo nas origens automáticas. */
  categoryId: string | null;
  categoryName: string | null;
  /** Id da linha de origem, para a tela linkar o lançamento manual. */
  sourceId: string | null;
}

export interface CashFlowTotals {
  inflowCents: number;
  outflowCents: number;
  netCents: number;
}

export interface CashFlowSummary {
  month: string;
  /** Movimento bancário: dinheiro de terceiros incluído. */
  cash: CashFlowTotals;
  /** Receita e despesa próprias da imobiliária. */
  result: CashFlowTotals;
  /** Quebra do resultado, para a tela não ter que reagrupar. */
  adminFeeCents: number;
  lateFeeCents: number;
  commissionEarnedCents: number;
  commissionPaidCents: number;
  manualIncomeCents: number;
  manualExpenseCents: number;
  /**
   * Dinheiro de terceiros ainda retido: repasses em aberto ou em trânsito, de
   * qualquer mês. É o que explica o saldo de caixa ser maior que o resultado.
   */
  pendingPayoutCents: number;
}

export interface CashFlowByCategory {
  categoryId: string | null;
  categoryName: string;
  direction: CashFlowDirection;
  amountCents: number;
}

export interface CashFlowStatement {
  month: string;
  movements: CashFlowMovement[];
  summary: CashFlowSummary;
  byCategory: CashFlowByCategory[];
}

/** Um mês da série (o gráfico). */
export interface CashFlowSeriesPoint {
  month: string;
  cashInCents: number;
  cashOutCents: number;
  cashNetCents: number;
  resultNetCents: number;
}

/* ------------------------------------------------------------ Categorias */

export const createCashFlowCategorySchema = z.object({
  // `code` NÃO entra: é sequencial por tenant, atribuído pelo repositório —
  // mesma decisão de `banks`.
  name: z.string().min(1).max(120),
  direction: cashFlowDirection,
});
export type CreateCashFlowCategoryInput = z.infer<typeof createCashFlowCategorySchema>;

export const updateCashFlowCategorySchema = createCashFlowCategorySchema
  .extend({ active: z.boolean() })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdateCashFlowCategoryInput = z.infer<typeof updateCashFlowCategorySchema>;

export interface CashFlowCategory {
  id: string;
  tenantId: string;
  code: number;
  name: string;
  direction: CashFlowDirection;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------- Lançamento manual */

/**
 * `amountCents` é sempre positivo — o sinal vem de `direction`. Guardar valor
 * negativo abriria a porta para uma despesa de −R$ 100 virar receita numa soma
 * distraída.
 */
export const createCashFlowEntrySchema = z.object({
  entryDate: isoDate,
  direction: cashFlowDirection,
  categoryId: z.string().uuid().optional(),
  bankId: z.string().uuid().optional(),
  amountCents: cents.refine((v) => v > 0, "O valor precisa ser maior que zero"),
  description: z.string().min(1).max(200),
  notes: z.string().max(1000).optional(),
});
export type CreateCashFlowEntryInput = z.infer<typeof createCashFlowEntrySchema>;

export const updateCashFlowEntrySchema = z
  .object({
    entryDate: isoDate.optional(),
    direction: cashFlowDirection.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    bankId: z.string().uuid().nullable().optional(),
    amountCents: cents.refine((v) => v > 0, "O valor precisa ser maior que zero").optional(),
    description: z.string().min(1).max(200).optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdateCashFlowEntryInput = z.infer<typeof updateCashFlowEntrySchema>;

export const listCashFlowEntriesQuerySchema = z.object({
  month: month.optional(),
  direction: cashFlowDirection.optional(),
  categoryId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListCashFlowEntriesQuery = z.infer<typeof listCashFlowEntriesQuerySchema>;

export interface CashFlowEntry {
  id: string;
  tenantId: string;
  entryDate: string;
  direction: CashFlowDirection;
  categoryId: string | null;
  categoryName: string | null;
  bankId: string | null;
  bankName: string | null;
  amountCents: number;
  description: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
