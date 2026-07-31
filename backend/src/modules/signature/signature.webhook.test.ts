import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { withTenant } from "../../shared/db.js";
import * as repo from "./signature.repository.js";
import { WEBHOOK_SECRET_HEADER } from "./signature.schema.js";

/**
 * Rota pública de callback da ZapSign. O que se testa aqui é o **gate**: o
 * provedor não assina os webhooks (não há HMAC), então o header secreto é a
 * única coisa entre a internet e a máquina de estados do contrato.
 *
 * Depende da infra de pé (`npm run infra:up`).
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("signature.webhook")).id;
const URL = `/webhooks/zapsign/${TENANT}`;

let app: FastifyInstance;
let secret: string;
/** Config real do tenant, para devolver o banco ao estado anterior. */
let saved: Awaited<ReturnType<typeof repo.findSettings>> = null;

before(async () => {
  app = await buildApp();
  saved = await repo.findSettings(TENANT);
  await repo.upsertSettings(TENANT, {
    apiTokenEnc: "v1.fake.fake.fake",
    apiTokenHint: "9999",
    sandbox: true,
    authMode: "assinaturaTela-tokenEmail",
    webhookSecret: `webhook-${randomUUID()}`,
  });
  secret = (await repo.findSettings(TENANT))!.webhookSecret!;
});

/**
 * Restaura a configuração original. Sem isto o token FAKE fica no banco de
 * desenvolvimento e a aplicação passa a achar que a ZapSign está conectada —
 * "Enviar para assinatura" quebra ao tentar decifrar a credencial de teste.
 */
after(async () => {
  await restoreSettings(saved);
  await app.close();
});

/** Devolve a linha ao estado anterior (ou remove, se não existia). */
async function restoreSettings(previous: Awaited<ReturnType<typeof repo.findSettings>>) {
  await withTenant(TENANT, async (client) => {
    if (!previous) {
      await client.query("DELETE FROM tenant_signature_settings WHERE tenant_id = $1", [
        TENANT,
      ]);
      return;
    }
    await client.query(
      `UPDATE tenant_signature_settings
          SET api_token_enc = $2, api_token_hint = $3, sandbox = $4,
              auth_mode = $5, webhook_secret = $6
        WHERE tenant_id = $1`,
      [
        TENANT,
        previous.apiTokenEnc,
        previous.apiTokenHint,
        previous.sandbox,
        previous.authMode,
        previous.webhookSecret,
      ],
    );
  });
}

const post = (headers: Record<string, string>, body: unknown) =>
  app.inject({ method: "POST", url: URL, headers, payload: body as object });

test("sem o header secreto o callback é rejeitado com 401", async () => {
  const res = await post({}, { event_type: "doc_signed", token: "qualquer" });
  assert.equal(res.statusCode, 401);
});

test("com segredo errado o callback é rejeitado com 401", async () => {
  const res = await post(
    { [WEBHOOK_SECRET_HEADER]: `${secret}x` },
    { event_type: "doc_signed", token: "qualquer" },
  );
  assert.equal(res.statusCode, 401);
});

test("tenant inexistente responde 401 (não confirma se o tenant existe)", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/webhooks/zapsign/00000000-0000-0000-0000-0000000000ff",
    headers: { [WEBHOOK_SECRET_HEADER]: secret },
    payload: { event_type: "doc_signed", token: "qualquer" },
  });
  assert.equal(res.statusCode, 401);
});

test("com o segredo correto, documento desconhecido é ignorado com 200", async () => {
  // Outro documento da mesma conta ZapSign (não gerado por nós) não pode virar
  // erro: a ZapSign reenfileiraria o callback indefinidamente.
  const res = await post(
    { [WEBHOOK_SECRET_HEADER]: secret },
    { event_type: "doc_signed", token: `desconhecido-${randomUUID()}`, status: "signed" },
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { data: { received: true } });
});

test("payload sem o token do documento é ignorado com 200", async () => {
  const res = await post({ [WEBHOOK_SECRET_HEADER]: secret }, { event_type: "doc_signed" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { data: { ignored: true } });
});

test("o webhook não vaza dados de outro tenant pelo token do documento", async () => {
  // Envelope deste tenant; o atacante conhece o docToken e tenta processá-lo
  // por outro tenant (com o segredo daquele tenant, que ele controlaria).
  const contractId = await withTenant(TENANT, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO contracts (tenant_id, status) VALUES ($1, 'RASCUNHO') RETURNING id",
      [TENANT],
    );
    return rows[0]!.id;
  });
  const docToken = `doc-${randomUUID()}`;

  try {
    await repo.insertEnvelope(TENANT, {
      contractId,
      version: 1,
      providerDocToken: docToken,
      authMode: "assinaturaTela-tokenEmail",
      sandbox: true,
      snapshot: {},
      signers: [],
    });

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/zapsign/00000000-0000-0000-0000-0000000000ff",
      headers: { [WEBHOOK_SECRET_HEADER]: secret },
      payload: { event_type: "doc_signed", token: docToken, status: "signed" },
    });
    assert.equal(res.statusCode, 401, "TENANT LEAKAGE: envelope alcançado por outro tenant");

    const envelope = await repo.findLatestEnvelope(TENANT, contractId);
    assert.equal(envelope?.status, "PENDENTE", "o envelope não pode ter sido concluído");
  } finally {
    await withTenant(TENANT, async (client) => {
      await client.query("DELETE FROM contracts WHERE id = $1", [contractId]);
    });
  }
});
