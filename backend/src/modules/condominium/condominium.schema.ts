import { z } from "zod";

/**
 * Condomínio (MOD-CONDOMINIO) — cadastro do condomínio administrado pela
 * imobiliária. Espelha a tela legada "Cadastro de Condomínios": identificação
 * (nome + endereço) e os parâmetros financeiros usados na cobrança (taxa de
 * administração em % e/ou valor fixo, juros e multa por atraso).
 *
 * `balanceCents` (Saldo) é DERIVADO da movimentação financeira (débitos,
 * despesas, boletos) — módulos ainda não implementados. Por isso é somente
 * leitura aqui: nasce em 0 e será atualizado pela movimentação no futuro.
 */

/** Percentual 0–100 com até 2 casas (taxa adm %, juros, multa). */
const percent = z.number().min(0).max(100);
/** Valor monetário em centavos (não-negativo). */
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

export const createCondominiumSchema = z.object({
  name: z.string().min(2).max(120),
  address: z.string().max(200).optional(),
  number: z.string().max(20).optional(),
  district: z.string().max(120).optional(),
  zip: z.string().max(9).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(2).optional(),
  adminFeePercent: percent.default(0),
  adminFeeFixedCents: cents.default(0),
  interestPercent: percent.default(0),
  penaltyPercent: percent.default(0),
});
export type CreateCondominiumInput = z.infer<typeof createCondominiumSchema>;

/** Atualização parcial. Não permite mexer no saldo (derivado). */
export const updateCondominiumSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    address: z.string().max(200).nullable().optional(),
    number: z.string().max(20).nullable().optional(),
    district: z.string().max(120).nullable().optional(),
    zip: z.string().max(9).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    state: z.string().max(2).nullable().optional(),
    adminFeePercent: percent.optional(),
    adminFeeFixedCents: cents.optional(),
    interestPercent: percent.optional(),
    penaltyPercent: percent.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdateCondominiumInput = z.infer<typeof updateCondominiumSchema>;

export interface Condominium {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  number: string | null;
  district: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  balanceCents: number;
  adminFeePercent: number;
  adminFeeFixedCents: number;
  interestPercent: number;
  penaltyPercent: number;
  createdAt: string;
  updatedAt: string;
}

/* ───────────────────────── Despesas do condomínio ──────────────────────────
 * Lançamento de despesa (tela legada "Cadastro de Despesas"). O "Lancto nº"
 * (`seq`) é atribuído pelo backend (sequencial por tenant) — não vem do input.
 * O Evento classifica a despesa (lookup de eventos). */

/** Data ISO (YYYY-MM-DD). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (YYYY-MM-DD)");

export const createExpenseSchema = z.object({
  entryDate: isoDate.optional(),
  eventId: z.string().uuid().optional(),
  amountCents: cents.default(0),
  notes: z.string().max(500).optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

/** Atualização parcial da despesa. `null` limpa Evento/Histórico. */
export const updateExpenseSchema = z
  .object({
    entryDate: isoDate.nullable().optional(),
    eventId: z.string().uuid().nullable().optional(),
    amountCents: cents.optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export interface CondominiumExpense {
  id: string;
  tenantId: string;
  condominiumId: string;
  seq: number | null;
  entryDate: string | null;
  eventId: string | null;
  eventName: string | null;
  amountCents: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────────── Cobrança do condomínio (contas a receber) ───────────────
 * Informa-se condomínio + período + vencimento; o sistema rateia as despesas
 * lançadas no período entre as unidades e soma o valor de condomínio de cada
 * imóvel (× meses do período). A conta vai para o locatário do contrato ativo
 * ou, na falta dele, para o proprietário. Ver `condo-billing.ts` para o cálculo. */

export const condoBillingQuerySchema = z
  .object({
    periodStart: isoDate,
    periodEnd: isoDate,
    dueDate: isoDate,
  })
  .refine((d) => d.periodEnd >= d.periodStart, {
    message: "Fim do período anterior ao início",
    path: ["periodEnd"],
  });
export type CondoBillingQuery = z.infer<typeof condoBillingQuerySchema>;

/** Uma unidade do condomínio na prévia da cobrança. */
export interface CondoBillingLine {
  propertyId: string;
  propertyCode: number | null;
  propertyAddress: string;
  /** Quem paga: locatário, proprietário, ou `null` quando não há nem um nem outro. */
  payerKind: "LOCATARIO" | "LOCADOR" | null;
  payerPersonId: string | null;
  payerName: string | null;
  months: number;
  condoFeeCents: number;
  condoTotalCents: number;
  expenseShareCents: number;
  totalCents: number;
  /** Já existe cobrança deste imóvel nesta competência — não será gerada de novo. */
  alreadyBilled: boolean;
}

export interface CondoBillingPreview {
  condominiumId: string;
  condominiumName: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  competence: string;
  months: number;
  unitCount: number;
  expensesCount: number;
  expensesTotalCents: number;
  totalCents: number;
  lines: CondoBillingLine[];
}

/** Resultado da geração: o que foi gravado e o que já existia. */
export interface CondoBillingResult extends CondoBillingPreview {
  created: number;
  /** Linhas não gravadas: já cobradas na competência ou sem pagador definido. */
  skipped: number;
}
