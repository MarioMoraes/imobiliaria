import { z } from "zod";

/**
 * MOD-FIN / Asaas — cobrança bancária. Nomenclatura: "cobrança" = um `payment`
 * no Asaas, sempre atrelado a uma parcela (receivable) nossa.
 */

/** UNDEFINED = a fatura mostra boleto E PIX, e o pagador escolhe. */
export const billingType = z.enum(["UNDEFINED", "BOLETO", "PIX"]);

/** Header em que o Asaas devolve o `authToken` configurado no webhook. */
export const WEBHOOK_TOKEN_HEADER = "asaas-access-token";

/**
 * Conexão da conta Asaas do tenant. `apiKey` só entra (nunca sai): a leitura
 * devolve apenas o hint dos últimos caracteres.
 */
export const savePaymentSettingsSchema = z.object({
  apiKey: z.string().min(10).max(500).optional(),
  sandbox: z.boolean().default(true),
  billingType: billingType.default("UNDEFINED"),
});
export type SavePaymentSettingsInput = z.infer<typeof savePaymentSettingsSchema>;

/** Config como o backend a usa internamente (chave já decifrada). */
export interface PaymentCredentials {
  apiKey: string;
  sandbox: boolean;
  billingType: string;
  webhookToken: string;
}

/** Config como a API a expõe — sem a chave. */
export interface PaymentSettingsView {
  connected: boolean;
  provider: string;
  sandbox: boolean;
  billingType: string;
  apiKeyHint: string | null;
  webhookUrl: string;
  webhookRegisteredAt: string | null;
  updatedAt: string | null;
}

/** Linha de tenant_payment_settings como o repositório a devolve. */
export interface PaymentSettingsRow {
  tenantId: string;
  provider: string;
  apiKeyEnc: string | null;
  apiKeyHint: string | null;
  sandbox: boolean;
  billingType: string;
  webhookToken: string | null;
  webhookRegisteredAt: string | null;
  updatedAt: string;
}

/**
 * Callback do Asaas. Só os campos que usamos: o `event` diz o que aconteceu e
 * o `payment` traz o estado atual da cobrança. O `id` do evento é a chave de
 * idempotência (o Asaas reentrega até receber 200).
 */
export const webhookPayloadSchema = z.object({
  id: z.string().optional(),
  event: z.string(),
  payment: z
    .object({
      id: z.string(),
      status: z.string().optional(),
      value: z.number().optional(),
      netValue: z.number().optional(),
      paymentDate: z.string().nullable().optional(),
      clientPaymentDate: z.string().nullable().optional(),
      externalReference: z.string().nullable().optional(),
      invoiceUrl: z.string().nullable().optional(),
      bankSlipUrl: z.string().nullable().optional(),
    })
    .optional(),
});
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

/** Resultado da emissão — o que a UI precisa para abrir o documento. */
export interface IssuedCharge {
  /** Link que o botão abre: a fatura (boleto + PIX) ou o PDF do boleto. */
  url: string;
  asaasChargeId: string;
  boletoUrl: string | null;
  invoiceUrl: string | null;
}
