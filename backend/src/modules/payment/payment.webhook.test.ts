import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { withTenant } from "../../shared/db.js";
import * as receivableRepo from "../receivable/receivable.repository.js";
import * as repo from "./payment.repository.js";
import { WEBHOOK_TOKEN_HEADER } from "./payment.schema.js";

/**
 * Rota pública de callback do Asaas. O que se testa aqui é o **gate** e a
 * **idempotência**: o provedor não assina os webhooks (não há HMAC), então o
 * authToken no header é a única coisa entre a internet e a baixa de um aluguel;
 * e o Asaas reentrega o evento até receber 200.
 *
 * Depende da infra de pé (`npm run infra:up`).
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("payment.webhook")).id;
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";
const URL = `/webhooks/asaas/${TENANT}`;

let app: FastifyInstance;
let token: string;
/** Config real do tenant, para devolver o banco ao estado anterior. */
let saved: Awaited<ReturnType<typeof repo.findSettings>> = null;

before(async () => {
  app = await buildApp();
  saved = await repo.findSettings(TENANT);
  await repo.upsertSettings(TENANT, {
    apiKeyEnc: "v1.fake.fake.fake",
    apiKeyHint: "9999",
    sandbox: true,
    billingType: "UNDEFINED",
    webhookToken: `webhook-${randomUUID()}`,
  });
  token = (await repo.findSettings(TENANT))!.webhookToken!;
});

/**
 * Restaura a configuração original. Sem isto a chave FAKE fica no banco de
 * desenvolvimento e a aplicação passa a achar que o Asaas está conectado —
 * "Emitir boleto" quebraria ao tentar decifrar a credencial de teste.
 */
after(async () => {
  await withTenant(TENANT, async (client) => {
    if (!saved) {
      await client.query("DELETE FROM tenant_payment_settings WHERE tenant_id = $1", [TENANT]);
      return;
    }
    await client.query(
      `UPDATE tenant_payment_settings
          SET api_key_enc = $2, api_key_hint = $3, sandbox = $4,
              billing_type = $5, webhook_token = $6
        WHERE tenant_id = $1`,
      [
        TENANT,
        saved.apiKeyEnc,
        saved.apiKeyHint,
        saved.sandbox,
        saved.billingType,
        saved.webhookToken,
      ],
    );
  });
  await app.close();
});

const post = (headers: Record<string, string>, body: unknown) =>
  app.inject({ method: "POST", url: URL, headers, payload: body as object });

const paymentEvent = (chargeId: string, eventId: string) => ({
  id: eventId,
  event: "PAYMENT_RECEIVED",
  payment: { id: chargeId, status: "RECEIVED", value: 2500, paymentDate: "2026-08-09" },
});

/** Parcela deste tenant, já vinculada a uma cobrança do Asaas. */
async function receivableWithCharge(chargeId: string): Promise<{ id: string; contractId: string }> {
  const contractId = await withTenant(TENANT, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO contracts (tenant_id, status) VALUES ($1, 'VIGENTE') RETURNING id",
      [TENANT],
    );
    return rows[0]!.id;
  });

  const receivable = await receivableRepo.insertReceivable(TENANT, {
    contractId,
    kind: "ALUGUEL",
    amountCents: 250_000,
    dueDate: "2026-08-10",
  });
  await receivableRepo.attachCharge(TENANT, receivable.id, {
    asaasChargeId: chargeId,
    boletoUrl: null,
    invoiceUrl: "https://sandbox.asaas.com/i/fake",
  });
  return { id: receivable.id, contractId };
}

async function dropContract(id: string): Promise<void> {
  await withTenant(TENANT, async (client) => {
    await client.query("DELETE FROM contracts WHERE id = $1", [id]);
  });
}

test("sem o header de token o callback é rejeitado com 401", async () => {
  const res = await post({}, paymentEvent("pay_x", randomUUID()));
  assert.equal(res.statusCode, 401);
});

test("com token errado o callback é rejeitado com 401", async () => {
  const res = await post({ [WEBHOOK_TOKEN_HEADER]: `${token}x` }, paymentEvent("pay_x", randomUUID()));
  assert.equal(res.statusCode, 401);
});

test("tenant inexistente responde 401 (não confirma se o tenant existe)", async () => {
  const res = await app.inject({
    method: "POST",
    url: `/webhooks/asaas/${OTHER_TENANT}`,
    headers: { [WEBHOOK_TOKEN_HEADER]: token },
    payload: paymentEvent("pay_x", randomUUID()) as object,
  });
  assert.equal(res.statusCode, 401);
});

test("cobrança desconhecida é ignorada com 200", async () => {
  // Cobrança criada fora do sistema, na mesma conta Asaas: virar erro faria o
  // provedor interromper a fila de webhooks do tenant.
  const res = await post(
    { [WEBHOOK_TOKEN_HEADER]: token },
    paymentEvent(`desconhecida-${randomUUID()}`, randomUUID()),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { data: { received: true } });
});

test("payload sem cobrança é ignorado com 200", async () => {
  const res = await post({ [WEBHOOK_TOKEN_HEADER]: token }, { event: "PAYMENT_CREATED" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { data: { received: true } });
});

test("PAYMENT_RECEIVED dá baixa na parcela, e a reentrega não duplica nada", async () => {
  const chargeId = `pay_${randomUUID()}`;
  const { id, contractId } = await receivableWithCharge(chargeId);

  try {
    const eventId = randomUUID();
    const res = await post({ [WEBHOOK_TOKEN_HEADER]: token }, paymentEvent(chargeId, eventId));
    assert.equal(res.statusCode, 200);

    const pago = await receivableRepo.findReceivable(TENANT, id);
    assert.equal(pago?.status, "PAGO");
    assert.equal(pago?.paidAt, "2026-08-09");
    assert.equal(pago?.paidAmountCents, 250_000);

    // Reentrega do MESMO evento (o Asaas repete até receber 200).
    const again = await post({ [WEBHOOK_TOKEN_HEADER]: token }, paymentEvent(chargeId, eventId));
    assert.equal(again.statusCode, 200);
    const depois = await receivableRepo.findReceivable(TENANT, id);
    assert.equal(depois?.status, "PAGO");
    assert.equal(depois?.paidAt, "2026-08-09", "a data do pagamento não pode ser reescrita");
  } finally {
    await dropContract(contractId);
  }
});

test("o webhook não alcança a parcela de outro tenant pelo id da cobrança", async () => {
  const chargeId = `pay_${randomUUID()}`;
  const { id, contractId } = await receivableWithCharge(chargeId);

  try {
    // O atacante conhece o id da cobrança e tenta processá-lo por outro tenant.
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/asaas/${OTHER_TENANT}`,
      headers: { [WEBHOOK_TOKEN_HEADER]: token },
      payload: paymentEvent(chargeId, randomUUID()) as object,
    });
    assert.equal(res.statusCode, 401, "TENANT LEAKAGE: cobrança alcançada por outro tenant");

    const intacta = await receivableRepo.findReceivable(TENANT, id);
    assert.equal(intacta?.status, "ABERTO", "a parcela não pode ter sido baixada");
  } finally {
    await dropContract(contractId);
  }
});
