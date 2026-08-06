import { z } from "zod";

/**
 * Forma de pagamento — lookup editável por tenant ("À vista", "Financiado",
 * "Parcelado direto"). É o "Cód + Forma de Pagamento" da tela legada de vendas.
 *
 * A forma é só a natureza do negócio; o detalhamento (sinal, número de
 * parcelas, banco) é texto livre na própria venda — cada venda combina o seu, e
 * cadastrá-lo aqui viraria um catálogo infinito.
 */

export const createPaymentMethodSchema = z.object({
  name: z.string().min(2).max(120),
});
export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;

export const updatePaymentMethodSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  active: z.boolean().optional(),
});
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;

export interface PaymentMethod {
  id: string;
  tenantId: string;
  /** Sequencial por tenant, gerado no insert (referência humana). */
  code: number;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
