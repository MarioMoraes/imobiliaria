import { z } from "zod";

/**
 * Venda do imóvel (MOD-VENDA) — o fechamento do negócio, emitido do cadastro do
 * imóvel a vender.
 *
 * **O comprador é texto livre, não uma FK para `persons`.** O que vai para a
 * escritura é o que foi digitado no dia do fechamento; editar a ficha da pessoa
 * meses depois não pode reescrever o que já foi lavrado em cartório. É a mesma
 * razão pela qual as testemunhas do contrato de administração não saem de
 * cadastro nenhum.
 *
 * `commissionPercent` é PERCENTUAL sobre `valueCents` — é o que
 * `commission.createForSale` espera para dividir a comissão entre a imobiliária
 * e o corretor.
 */

/** Estado civil do comprador — mesmos valores de `persons.marital_status`. */
export const buyerMaritalStatus = z.enum([
  "SOLTEIRO",
  "CASADO",
  "DIVORCIADO",
  "VIUVO",
  "UNIAO_ESTAVEL",
]);
export type BuyerMaritalStatus = z.infer<typeof buyerMaritalStatus>;

const optionalText = (max: number) => z.string().max(max).nullish();

const saleFields = {
  soldAt: z.string().date().nullish(),

  buyerName: z.string().min(2).max(200),
  buyerNationality: optionalText(60),
  buyerMaritalStatus: buyerMaritalStatus.nullish(),
  buyerOccupation: optionalText(120),
  buyerAddress: optionalText(200),
  buyerDistrict: optionalText(120),
  buyerCity: optionalText(120),
  buyerState: optionalText(2),
  buyerZip: optionalText(9),
  buyerCpf: optionalText(18),
  buyerRg: optionalText(20),

  spouseName: optionalText(200),
  spouseNationality: optionalText(60),
  spouseOccupation: optionalText(120),
  spouseCpf: optionalText(18),
  spouseRg: optionalText(20),
  marriageRegime: optionalText(120),

  paymentMethodId: z.string().uuid().nullish(),
  paymentNotes: z.string().max(4000).nullish(),
  /** % sobre o valor da venda (0–100). */
  commissionPercent: z.number().min(0).max(100).default(0),
  valueCents: z.number().int().nonnegative().max(100_000_000_000).default(0),
  brokerId: z.string().uuid().nullish(),
};

export const createSaleSchema = z.object({
  propertyId: z.string().uuid(),
  ...saleFields,
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

/**
 * `propertyId` fica de fora: mudar o imóvel de uma venda fechada mexeria no
 * imóvel marcado como vendido e na comissão já lançada. Errou o imóvel, apaga a
 * venda e registra de novo.
 */
export const updateSaleSchema = z.object({
  ...saleFields,
  buyerName: z.string().min(2).max(200).optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  valueCents: z.number().int().nonnegative().max(100_000_000_000).optional(),
});
export type UpdateSaleInput = z.infer<typeof updateSaleSchema>;

export const listSalesQuerySchema = z.object({
  propertyId: z.string().uuid().optional(),
});
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;

export interface Sale {
  id: string;
  tenantId: string;
  /** Sequencial por tenant (o "Nro/Cód" da tela legada). */
  code: number;
  propertyId: string;
  soldAt: string | null;

  buyerName: string;
  buyerNationality: string | null;
  buyerMaritalStatus: string | null;
  buyerOccupation: string | null;
  buyerAddress: string | null;
  buyerDistrict: string | null;
  buyerCity: string | null;
  buyerState: string | null;
  buyerZip: string | null;
  buyerCpf: string | null;
  buyerRg: string | null;

  spouseName: string | null;
  spouseNationality: string | null;
  spouseOccupation: string | null;
  spouseCpf: string | null;
  spouseRg: string | null;
  marriageRegime: string | null;

  paymentMethodId: string | null;
  /** Nome da forma de pagamento, resolvido no SELECT (só leitura). */
  paymentMethodName: string | null;
  paymentNotes: string | null;
  commissionPercent: number;
  valueCents: number;
  brokerId: string | null;
  /** Nome do corretor, resolvido no SELECT (só leitura). */
  brokerName: string | null;

  createdAt: string;
  updatedAt: string;
}
