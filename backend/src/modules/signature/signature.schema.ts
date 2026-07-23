import { z } from "zod";
import { AUTH_MODES } from "./zapsign.client.js";

/**
 * MOD-ASSINATURA — contratos assinados eletronicamente via ZapSign.
 * Nomenclatura: "envelope" = um envio do contrato ao provedor; "signatário" =
 * uma parte dentro desse envelope.
 */

export const authMode = z.enum(AUTH_MODES);

/** Situação do envelope no nosso domínio (traduzida do provedor). */
export const envelopeStatus = z.enum([
  "PENDENTE",
  "ASSINADO",
  "RECUSADO",
  "CANCELADO",
  "EXPIRADO",
]);

export const signerStatus = z.enum(["PENDENTE", "ASSINADO", "RECUSADO"]);

/* ------------------------------------------------ Configuração do tenant */

/**
 * Conexão da conta ZapSign do tenant. `apiToken` só entra (nunca sai): a
 * leitura devolve apenas o hint dos últimos caracteres.
 */
export const saveSettingsSchema = z.object({
  apiToken: z.string().min(10).max(500).optional(),
  sandbox: z.boolean().default(true),
  authMode: authMode.default("assinaturaTela-tokenEmail"),
});
export type SaveSettingsInput = z.infer<typeof saveSettingsSchema>;

/** Config como o backend a usa internamente (token já decifrado). */
export interface SignatureCredentials {
  token: string;
  sandbox: boolean;
  authMode: string;
  webhookSecret: string;
}

/** Config como a API a expõe — sem o token. */
export interface SignatureSettingsView {
  connected: boolean;
  provider: string;
  sandbox: boolean;
  authMode: string;
  tokenHint: string | null;
  webhookUrl: string;
  webhookRegisteredAt: string | null;
  updatedAt: string | null;
}

/* ---------------------------------------------------------- Envelope */

export interface SignatureSigner {
  id: string;
  partyId: string | null;
  providerSignerToken: string;
  role: string | null;
  name: string;
  email: string | null;
  signUrl: string | null;
  status: string;
  signedAt: string | null;
}

export interface SignatureEnvelope {
  id: string;
  contractId: string;
  version: number | null;
  provider: string;
  providerDocToken: string;
  status: string;
  authMode: string;
  sandbox: boolean;
  hasSignedPdf: boolean;
  signedAt: string | null;
  createdAt: string;
  signers: SignatureSigner[];
}

/* ----------------------------------------------------------- Webhook */

/**
 * Payload do webhook da ZapSign. Deliberadamente permissivo (`passthrough` nos
 * signatários, campos opcionais): o provedor adiciona campos com frequência e
 * um evento recusado por schema seria uma assinatura perdida. O que importa é
 * `token` — a chave de correlação com o envelope.
 */
export const webhookPayloadSchema = z
  .object({
    event_type: z.string().optional(),
    token: z.string().min(1),
    status: z.string().optional(),
    external_id: z.string().nullish(),
    name: z.string().nullish(),
    signed_file: z.string().nullish(),
    original_file: z.string().nullish(),
    signers: z
      .array(
        z
          .object({
            token: z.string(),
            status: z.string().optional(),
            signed_at: z.string().nullish(),
            name: z.string().nullish(),
            email: z.string().nullish(),
            sign_url: z.string().nullish(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

/** Header que autentica o callback (a ZapSign não assina os webhooks). */
export const WEBHOOK_SECRET_HEADER = "x-officesai-signature-secret";
