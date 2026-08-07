import { z } from "zod";

/**
 * Banco — conta bancária da imobiliária (tela legada "Bancos"). Identificação
 * (código, nome, agência, conta) + favorito são editáveis.
 *
 * **Saldo é DERIVADO na leitura** dos lançamentos manuais vinculados à conta
 * (`cash_flow_entries.bank_id`), e não da coluna `banks.balance_cents`. A coluna
 * existe desde o início marcada como "derivada", mas a rotina que a alimentaria
 * nunca foi escrita: toda conta mostrava R$ 0,00 como se fosse saldo real.
 * Derivando, o número se conserta sozinho quando um lançamento é editado ou
 * apagado — a mesma escolha de `condominium.service` para o saldo do condomínio.
 *
 * **Cofre, Em Trânsito e Provável Saldo saíram.** Não há fonte de dado para eles
 * (nem coluna alimentada, nem tabela de origem), e campo monetário zerado numa
 * tela financeira é lido como saldo, não como ausência. Voltam quando houver de
 * onde derivá-los. As colunas continuam no banco, sem leitor.
 *
 * Escopo do saldo: só o lançamento manual carrega `bank_id` hoje. Aluguel,
 * repasse e comissão não escolhem conta, então não entram — ver o extrato do
 * Fluxo de Caixa para o movimento completo.
 */

export const createBankSchema = z.object({
  // `code` NÃO entra: é sequencial por tenant, atribuído pelo repositório
  // (MAX(code)+1 sob lock). Aceitar um valor do cliente permitia criar códigos
  // duplicados de propósito — e agora há índice único, então isso seria só um
  // 409. O formulário já não envia o campo.
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
  /** Derivado: entradas − saídas dos lançamentos manuais desta conta. */
  balanceCents: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
