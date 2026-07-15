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
const cents = z.number().int().nonnegative();

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
