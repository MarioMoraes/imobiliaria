import type { PoolClient } from "pg";
import { withTenant } from "../../shared/db.js";
import { AppError } from "../../shared/errors.js";
import type { SignatureEnvelope, SignatureSigner } from "./signature.schema.js";

/**
 * Acesso a dados do MOD-ASSINATURA. Tudo passa por `withTenant` (RLS) — nenhum
 * caminho, nem o do webhook, toca o pool direto.
 */

/* ------------------------------------------------ Configuração do tenant */

interface SettingsRow {
  tenant_id: string;
  provider: string;
  api_token_enc: string | null;
  api_token_hint: string | null;
  sandbox: boolean;
  auth_mode: string;
  webhook_secret: string | null;
  webhook_registered_at: Date | null;
  updated_at: Date;
}

export interface SettingsRecord {
  provider: string;
  apiTokenEnc: string | null;
  apiTokenHint: string | null;
  sandbox: boolean;
  authMode: string;
  webhookSecret: string | null;
  webhookRegisteredAt: string | null;
  updatedAt: string;
}

const toSettings = (r: SettingsRow): SettingsRecord => ({
  provider: r.provider,
  apiTokenEnc: r.api_token_enc,
  apiTokenHint: r.api_token_hint,
  sandbox: r.sandbox,
  authMode: r.auth_mode,
  webhookSecret: r.webhook_secret,
  webhookRegisteredAt: r.webhook_registered_at?.toISOString() ?? null,
  updatedAt: r.updated_at.toISOString(),
});

export async function findSettings(tenantId: string): Promise<SettingsRecord | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<SettingsRow>(
      "SELECT * FROM tenant_signature_settings WHERE tenant_id = $1",
      [tenantId],
    );
    return rows[0] ? toSettings(rows[0]) : null;
  });
}

/** Upsert da configuração. Campos `undefined` preservam o valor atual. */
export async function upsertSettings(
  tenantId: string,
  input: {
    apiTokenEnc?: string;
    apiTokenHint?: string;
    sandbox: boolean;
    authMode: string;
    webhookSecret: string;
  },
): Promise<SettingsRecord> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<SettingsRow>(
      `INSERT INTO tenant_signature_settings
         (tenant_id, api_token_enc, api_token_hint, sandbox, auth_mode, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id) DO UPDATE SET
         api_token_enc  = COALESCE(EXCLUDED.api_token_enc, tenant_signature_settings.api_token_enc),
         api_token_hint = COALESCE(EXCLUDED.api_token_hint, tenant_signature_settings.api_token_hint),
         sandbox        = EXCLUDED.sandbox,
         auth_mode      = EXCLUDED.auth_mode,
         webhook_secret = COALESCE(tenant_signature_settings.webhook_secret, EXCLUDED.webhook_secret),
         updated_at     = now()
       RETURNING *`,
      [
        tenantId,
        input.apiTokenEnc ?? null,
        input.apiTokenHint ?? null,
        input.sandbox,
        input.authMode,
        input.webhookSecret,
      ],
    );
    return toSettings(rows[0]!);
  });
}

export async function markWebhookRegistered(tenantId: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      "UPDATE tenant_signature_settings SET webhook_registered_at = now(), updated_at = now() WHERE tenant_id = $1",
      [tenantId],
    );
  });
}

/** Desconecta: apaga o token, mantendo a linha (e o webhook_secret) para logs. */
export async function clearCredentials(tenantId: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE tenant_signature_settings
          SET api_token_enc = NULL, api_token_hint = NULL,
              webhook_registered_at = NULL, updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId],
    );
    return (rowCount ?? 0) > 0;
  });
}

/* ------------------------------------------------------------ Envelopes */

interface EnvelopeRow {
  id: string;
  contract_id: string;
  version: number | null;
  provider: string;
  provider_doc_token: string;
  status: string;
  auth_mode: string;
  sandbox: boolean;
  signed_pdf_storage_key: string | null;
  signed_at: Date | null;
  created_at: Date;
}

interface SignerRow {
  id: string;
  envelope_id: string;
  party_id: string | null;
  provider_signer_token: string;
  role: string | null;
  name: string;
  email: string | null;
  sign_url: string | null;
  status: string;
  signed_at: Date | null;
}

const toSigner = (r: SignerRow): SignatureSigner => ({
  id: r.id,
  partyId: r.party_id,
  providerSignerToken: r.provider_signer_token,
  role: r.role,
  name: r.name,
  email: r.email,
  signUrl: r.sign_url,
  status: r.status,
  signedAt: r.signed_at?.toISOString() ?? null,
});

const toEnvelope = (r: EnvelopeRow, signers: SignerRow[]): SignatureEnvelope => ({
  id: r.id,
  contractId: r.contract_id,
  version: r.version,
  provider: r.provider,
  providerDocToken: r.provider_doc_token,
  status: r.status,
  authMode: r.auth_mode,
  sandbox: r.sandbox,
  hasSignedPdf: r.signed_pdf_storage_key !== null,
  signedAt: r.signed_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
  signers: signers.map(toSigner),
});

async function loadSigners(client: PoolClient, envelopeId: string): Promise<SignerRow[]> {
  const { rows } = await client.query<SignerRow>(
    "SELECT * FROM contract_signature_signers WHERE envelope_id = $1 ORDER BY created_at",
    [envelopeId],
  );
  return rows;
}

/** Envelope mais recente do contrato (é o que a tela mostra). */
export async function findLatestEnvelope(
  tenantId: string,
  contractId: string,
): Promise<SignatureEnvelope | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<EnvelopeRow>(
      `SELECT * FROM contract_signature_envelopes
        WHERE contract_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [contractId],
    );
    const row = rows[0];
    return row ? toEnvelope(row, await loadSigners(client, row.id)) : null;
  });
}

export async function findEnvelopeByDocToken(
  tenantId: string,
  docToken: string,
): Promise<SignatureEnvelope | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<EnvelopeRow>(
      "SELECT * FROM contract_signature_envelopes WHERE provider_doc_token = $1",
      [docToken],
    );
    const row = rows[0];
    return row ? toEnvelope(row, await loadSigners(client, row.id)) : null;
  });
}

/** Cria o envelope e seus signatários numa única transação. */
export async function insertEnvelope(
  tenantId: string,
  input: {
    contractId: string;
    version: number | null;
    providerDocToken: string;
    authMode: string;
    sandbox: boolean;
    snapshot: unknown;
    signers: {
      partyId: string | null;
      providerSignerToken: string;
      role: string | null;
      name: string;
      email: string | null;
      signUrl: string | null;
      status: string;
    }[];
  },
): Promise<SignatureEnvelope> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<EnvelopeRow>(
      `INSERT INTO contract_signature_envelopes
         (tenant_id, contract_id, version, provider_doc_token, auth_mode, sandbox, provider_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        input.contractId,
        input.version,
        input.providerDocToken,
        input.authMode,
        input.sandbox,
        JSON.stringify(input.snapshot),
      ],
    );
    const envelope = rows[0]!;

    for (const s of input.signers) {
      await client.query(
        `INSERT INTO contract_signature_signers
           (tenant_id, envelope_id, party_id, provider_signer_token, role, name, email, sign_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          tenantId,
          envelope.id,
          s.partyId,
          s.providerSignerToken,
          s.role,
          s.name,
          s.email,
          s.signUrl,
          s.status,
        ],
      );
    }

    return toEnvelope(envelope, await loadSigners(client, envelope.id));
  });
}

/**
 * Aplica o estado do provedor em UMA transação: signatários, espelho em
 * contract_parties.signed_at e o envelope. `signedStorageKey` só é gravado
 * quando o PDF assinado já está no nosso storage.
 *
 * Retorna `justCompleted = true` apenas na transição para ASSINADO — é o que
 * garante que reprocessar o mesmo webhook não versione nem publique de novo.
 */
export async function applyEnvelopeState(
  tenantId: string,
  input: {
    envelopeId: string;
    status: string;
    snapshot: unknown;
    signedStorageKey?: string | null;
    signers: { providerSignerToken: string; status: string; signedAt: string | null }[];
  },
): Promise<{ justCompleted: boolean; envelope: SignatureEnvelope }> {
  return withTenant(tenantId, async (client) => {
    for (const s of input.signers) {
      const { rows } = await client.query<{ party_id: string | null }>(
        `UPDATE contract_signature_signers
            SET status = $1, signed_at = $2, updated_at = now()
          WHERE envelope_id = $3 AND provider_signer_token = $4
          RETURNING party_id`,
        [s.status, s.signedAt, input.envelopeId, s.providerSignerToken],
      );
      // Espelha em contract_parties: é a coluna que o resto do sistema lê.
      const partyId = rows[0]?.party_id;
      if (partyId && s.signedAt) {
        await client.query(
          "UPDATE contract_parties SET signed_at = $1 WHERE id = $2",
          [s.signedAt, partyId],
        );
      }
    }

    // A guarda `status <> $2` é o coração da idempotência: o segundo webhook
    // idêntico não casa e devolve 0 linhas.
    const { rows: completed } = await client.query<EnvelopeRow>(
      `UPDATE contract_signature_envelopes
          SET status = $2,
              provider_snapshot = $3,
              signed_pdf_storage_key = COALESCE($4, signed_pdf_storage_key),
              signed_at = CASE WHEN $2 = 'ASSINADO' THEN now() ELSE signed_at END,
              updated_at = now()
        WHERE id = $1 AND status <> $2
        RETURNING *`,
      [input.envelopeId, input.status, JSON.stringify(input.snapshot), input.signedStorageKey ?? null],
    );

    let row = completed[0];
    if (!row) {
      // Status inalterado: ainda assim atualiza o snapshot (auditoria).
      const { rows } = await client.query<EnvelopeRow>(
        `UPDATE contract_signature_envelopes
            SET provider_snapshot = $2, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [input.envelopeId, JSON.stringify(input.snapshot)],
      );
      // Zero linhas aqui só acontece se o envelope não pertencer ao tenant (a
      // RLS o esconde). Falha explícita em vez de estourar num campo undefined.
      if (!rows[0]) {
        throw new AppError(
          "ERR_ASSINATURA_004",
          404,
          "Envelope de assinatura não encontrado para este tenant",
        );
      }
      row = rows[0];
    }

    return {
      justCompleted: completed.length > 0 && input.status === "ASSINADO",
      envelope: toEnvelope(row, await loadSigners(client, row.id)),
    };
  });
}
