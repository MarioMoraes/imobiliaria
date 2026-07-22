import { z } from "zod";

/**
 * Banco — conta bancária da imobiliária (tela legada "Bancos"). Identificação
 * (código, nome, agência, conta) + favorito são editáveis. Saldo, Cofre e Em
 * Trânsito são DERIVADOS da movimentação financeira (rotinas futuras) e por isso
 * NÃO entram nos schemas de escrita: nascem em 0 e são somente-leitura na tela.
 * `probableBalanceCents` (Provável Saldo) é calculado no repositório: Saldo + Em
 * Trânsito (não é coluna).
 */

export const createBankSchema = z.object({
  // Código é auto-incremento por tenant: se omitido, o repositório atribui o
  // próximo (MAX(code)+1). Ainda aceita um valor explícito, se enviado.
  code: z.number().int().min(0).optional(),
  name: z.string().min(1).max(120),
  agency: z.string().max(60).optional(),
  accountNumber: z.string().max(60).optional(),
  favorite: z.boolean().default(false),
});
export type CreateBankInput = z.infer<typeof createBankSchema>;

/** Atualização parcial — mesmos campos editáveis do create. */
export const updateBankSchema = createBankSchema.partial();
export type UpdateBankInput = z.infer<typeof updateBankSchema>;

export interface Bank {
  id: string;
  tenantId: string;
  code: number;
  name: string;
  agency: string | null;
  accountNumber: string | null;
  favorite: boolean;
  balanceCents: number;
  vaultCents: number;
  inTransitCents: number;
  probableBalanceCents: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
