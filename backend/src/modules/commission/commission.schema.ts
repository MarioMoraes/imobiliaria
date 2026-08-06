import { z } from "zod";

/**
 * Comissão (MOD-FIN-05) — hoje a da venda do imóvel, amanhã a da locação.
 *
 * O desenho central: **uma linha por parte**. A comissão que a imobiliária
 * recebe (`IMOBILIARIA`) é receita; a que o corretor recebe (`CORRETOR`) é
 * despesa. São dois movimentos de caixa, possivelmente em datas diferentes —
 * guardar só o líquido apagaria a despesa e faria a margem da venda parecer o
 * valor cheio.
 */

export const commissionParty = z.enum(["IMOBILIARIA", "CORRETOR"]);
export type CommissionParty = z.infer<typeof commissionParty>;

export const commissionKind = z.enum(["VENDA", "LOCACAO"]);
export type CommissionKind = z.infer<typeof commissionKind>;

/**
 * Ciclo de vida. Só três estados: `QUITADO` cobre tanto "recebemos do cliente"
 * quanto "pagamos o corretor" — quem dá o sentido é `party`, e duplicar em
 * RECEBIDO/PAGO só criaria a chance de gravar o par errado.
 */
export const commissionStatus = z.enum(["ABERTO", "QUITADO", "CANCELADO"]);
export type CommissionStatus = z.infer<typeof commissionStatus>;

/** Mesmo teto de `payable.schema.ts`: BIGINT lido com Number() cabe em 2^53. */
const cents = z.number().int().nonnegative().max(100_000_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (YYYY-MM-DD)");
const month = z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido (YYYY-MM)");
const percent = z.number().min(0).max(100);

/**
 * Lançamento manual de comissão (uma parte por vez). Serve para a venda fechada
 * fora do sistema enquanto o módulo de venda não existe; depois continua valendo
 * para o acerto avulso.
 *
 * `amountCents` é opcional: informado, manda; ausente, sai de `baseCents` ×
 * `percent`. Quem lança da tela normalmente sabe o valor da venda e o percentual.
 */
export const createCommissionSchema = z
  .object({
    kind: commissionKind.default("VENDA"),
    party: commissionParty,
    propertyId: z.string().uuid().optional(),
    contractId: z.string().uuid().optional(),
    brokerId: z.string().uuid().optional(),
    description: z.string().max(200).optional(),
    baseCents: cents.default(0),
    percent: percent.default(0),
    amountCents: cents.optional(),
    dueDate: isoDate,
  })
  .refine((d) => d.party !== "CORRETOR" || !!d.brokerId, {
    message: "Comissão de corretor precisa do corretor",
    path: ["brokerId"],
  })
  .refine((d) => d.amountCents !== undefined || (d.baseCents > 0 && d.percent > 0), {
    message: "Informe o valor da comissão ou a base e o percentual",
    path: ["amountCents"],
  });
export type CreateCommissionInput = z.infer<typeof createCommissionSchema>;

/**
 * Edição. Os campos de ciclo de vida (`status`, `settledAt`,
 * `settledAmountCents`) ficam de fora, como em `payables`: quem os move é
 * `settle`/`cancel`, que conhecem as transições válidas.
 */
export const updateCommissionSchema = z
  .object({
    description: z.string().max(200).nullable().optional(),
    baseCents: cents.optional(),
    percent: percent.optional(),
    amountCents: cents.optional(),
    dueDate: isoDate.optional(),
    brokerId: z.string().uuid().nullable().optional(),
    propertyId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdateCommissionInput = z.infer<typeof updateCommissionSchema>;

/** Campos de ciclo de vida — INTERNO, montado só pelo service. */
export interface CommissionStateChange {
  status?: CommissionStatus;
  settledAt?: string | null;
  settledAmountCents?: number | null;
}

export type PatchCommissionInput = UpdateCommissionInput & CommissionStateChange;

/**
 * Quitação. `settledAt` é a data do CAIXA (quando o dinheiro entrou ou saiu),
 * não a do clique — é ela que posiciona o movimento no fluxo de caixa.
 */
export const settleCommissionSchema = z.object({
  settledAt: isoDate.optional(),
  settledAmountCents: cents.optional(),
});
export type SettleCommissionInput = z.infer<typeof settleCommissionSchema>;

export const listCommissionsQuerySchema = z.object({
  status: commissionStatus.optional(),
  party: commissionParty.optional(),
  kind: commissionKind.optional(),
  brokerId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  saleId: z.string().uuid().optional(),
  /** Mês de VENCIMENTO (YYYY-MM). */
  dueMonth: month.optional(),
  /** Mês da QUITAÇÃO (YYYY-MM) — a visão de caixa. */
  settledMonth: month.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListCommissionsQuery = z.infer<typeof listCommissionsQuerySchema>;

export interface Commission {
  id: string;
  tenantId: string;
  kind: string;
  party: CommissionParty;
  propertyId: string | null;
  /** Código do imóvel (sequencial por tenant) — a listagem mostra ele, não o UUID. */
  propertyCode: number | null;
  contractId: string | null;
  saleId: string | null;
  brokerId: string | null;
  /** Nome do corretor (LEFT JOIN brokers). */
  brokerName: string | null;
  description: string | null;
  baseCents: number;
  percentSnapshot: number;
  amountCents: number;
  dueDate: string;
  status: string;
  settledAt: string | null;
  settledAmountCents: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Indicadores do mês, agregados no banco (mesmo motivo de `PayableSummary`). */
export interface CommissionSummary {
  month: string;
  /** A receber da imobiliária, em aberto, vencendo no mês. */
  receivableOpenCents: number;
  /** A pagar a corretores, em aberto, vencendo no mês. */
  payableOpenCents: number;
  /** Recebido pela imobiliária no mês (pela data da quitação). */
  receivedCents: number;
  /** Pago a corretores no mês (pela data da quitação). */
  paidCents: number;
  /** Quantos lançamentos em aberto existem no total (badge do card). */
  pendingCount: number;
}

/** Uma parte pronta para inserção (saída de `buildCommissionSplit`). */
export interface CommissionSplitEntry {
  party: CommissionParty;
  brokerId: string | null;
  baseCents: number;
  percent: number;
  amountCents: number;
  dueDate: string;
  description: string;
}
