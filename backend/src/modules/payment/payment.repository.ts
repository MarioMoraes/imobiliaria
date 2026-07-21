import { withTenant } from "../../shared/db.js";
import type { PaymentSettingsRow } from "./payment.schema.js";

/**
 * Acesso a dados do MOD-FIN/Asaas. Tudo passa por `withTenant` (RLS) — nenhum
 * caminho, nem o do webhook, toca o pool direto.
 */

/* ------------------------------------------------ Configuração do tenant */

interface SettingsRow {
  tenant_id: string;
  provider: string;
  api_key_enc: string | null;
  api_key_hint: string | null;
  sandbox: boolean;
  billing_type: string;
  webhook_token: string | null;
  webhook_registered_at: Date | null;
  updated_at: Date;
}

const toSettings = (r: SettingsRow): PaymentSettingsRow => ({
  tenantId: r.tenant_id,
  provider: r.provider,
  apiKeyEnc: r.api_key_enc,
  apiKeyHint: r.api_key_hint,
  sandbox: r.sandbox,
  billingType: r.billing_type,
  webhookToken: r.webhook_token,
  webhookRegisteredAt: r.webhook_registered_at?.toISOString() ?? null,
  updatedAt: r.updated_at.toISOString(),
});

export async function findSettings(tenantId: string): Promise<PaymentSettingsRow | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<SettingsRow>(
      "SELECT * FROM tenant_payment_settings WHERE tenant_id = $1",
      [tenantId],
    );
    return rows[0] ? toSettings(rows[0]) : null;
  });
}

/** Upsert da configuração. Campos `undefined` preservam o valor atual. */
export async function upsertSettings(
  tenantId: string,
  input: {
    apiKeyEnc?: string;
    apiKeyHint?: string;
    sandbox: boolean;
    billingType: string;
    webhookToken: string;
  },
): Promise<PaymentSettingsRow> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<SettingsRow>(
      `INSERT INTO tenant_payment_settings
         (tenant_id, api_key_enc, api_key_hint, sandbox, billing_type, webhook_token)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id) DO UPDATE SET
         api_key_enc   = COALESCE(EXCLUDED.api_key_enc, tenant_payment_settings.api_key_enc),
         api_key_hint  = COALESCE(EXCLUDED.api_key_hint, tenant_payment_settings.api_key_hint),
         sandbox       = EXCLUDED.sandbox,
         billing_type  = EXCLUDED.billing_type,
         webhook_token = COALESCE(tenant_payment_settings.webhook_token, EXCLUDED.webhook_token),
         updated_at    = now()
       RETURNING *`,
      [
        tenantId,
        input.apiKeyEnc ?? null,
        input.apiKeyHint ?? null,
        input.sandbox,
        input.billingType,
        input.webhookToken,
      ],
    );
    return toSettings(rows[0]!);
  });
}

export async function markWebhookRegistered(tenantId: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      "UPDATE tenant_payment_settings SET webhook_registered_at = now(), updated_at = now() WHERE tenant_id = $1",
      [tenantId],
    );
  });
}

/** Desconecta: apaga a chave, mantendo a linha (e o webhook_token) para logs. */
export async function clearCredentials(tenantId: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE tenant_payment_settings
          SET api_key_enc = NULL, api_key_hint = NULL,
              webhook_registered_at = NULL, updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId],
    );
    return (rowCount ?? 0) > 0;
  });
}

/* --------------------------------------------- Clientes (pessoa ↔ Asaas) */

/** Id do cliente no Asaas para esta pessoa, no ambiente informado. */
export async function findCustomerId(
  tenantId: string,
  personId: string,
  sandbox: boolean,
): Promise<string | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ asaas_customer_id: string }>(
      `SELECT asaas_customer_id FROM asaas_customers
        WHERE person_id = $1 AND sandbox = $2`,
      [personId, sandbox],
    );
    return rows[0]?.asaas_customer_id ?? null;
  });
}

/**
 * Grava o vínculo. `DO UPDATE` em vez de `DO NOTHING` porque duas emissões
 * simultâneas podem criar dois clientes no Asaas — vence o último, e o cliente
 * órfão fica inofensivo no painel do provedor.
 */
export async function linkCustomer(
  tenantId: string,
  personId: string,
  sandbox: boolean,
  asaasCustomerId: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO asaas_customers (tenant_id, person_id, sandbox, asaas_customer_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, person_id, sandbox)
       DO UPDATE SET asaas_customer_id = EXCLUDED.asaas_customer_id`,
      [tenantId, personId, sandbox, asaasCustomerId],
    );
  });
}

/* ---------------------------------------------------- Eventos do webhook */

/**
 * Marca o evento como processado. Retorna `false` se ele já tinha sido tratado
 * — é o guard de idempotência do MOD-FIN-03 (o Asaas reentrega até receber 200).
 */
export async function claimEvent(
  tenantId: string,
  event: { eventId: string; eventType: string; paymentId: string | null; payload: unknown },
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `INSERT INTO asaas_webhook_events (tenant_id, event_id, event_type, payment_id, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, event_id) DO NOTHING`,
      [tenantId, event.eventId, event.eventType, event.paymentId, JSON.stringify(event.payload)],
    );
    return (rowCount ?? 0) > 0;
  });
}
