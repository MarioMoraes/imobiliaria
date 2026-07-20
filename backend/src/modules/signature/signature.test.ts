import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { withTenant } from "../../shared/db.js";
import { insertContract } from "../contract/contract.repository.js";
import { createContractSchema } from "../contract/contract.schema.js";
import * as repo from "./signature.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT do MOD-ASSINATURA (SPEC 3.1 e 14) —
 * obrigatório no CI. Aqui o vazamento seria grave em dobro: além dos contratos,
 * a tabela de settings guarda o token da conta ZapSign da imobiliária.
 *
 * Depende da infra de pé (`npm run infra:up`).
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

async function newContract(): Promise<string> {
  const contract = await insertContract(
    DEMO_TENANT,
    createContractSchema.parse({ status: "RASCUNHO" }),
  );
  return contract.id;
}

/**
 * Limpeza. Precisa passar por `withTenant`: fora dele o `app.tenant_id` fica
 * vazio e a policy tenta converter '' em uuid (erro 22P02) — além de a linha
 * não ser visível.
 */
async function dropContract(contractId: string): Promise<void> {
  await withTenant(DEMO_TENANT, async (client) => {
    await client.query("DELETE FROM contracts WHERE id = $1", [contractId]);
  });
}

/**
 * Os testes abaixo gravam credenciais FICTÍCIAS no tenant demo. Sem restaurar,
 * a aplicação de desenvolvimento passa a achar que a ZapSign está conectada e
 * "Enviar para assinatura" falha ao decifrar o token de teste.
 */
let saved: Awaited<ReturnType<typeof repo.findSettings>> = null;

before(async () => {
  saved = await repo.findSettings(DEMO_TENANT);
});

after(async () => {
  await withTenant(DEMO_TENANT, async (client) => {
    if (!saved) {
      await client.query("DELETE FROM tenant_signature_settings WHERE tenant_id = $1", [
        DEMO_TENANT,
      ]);
      return;
    }
    await client.query(
      `UPDATE tenant_signature_settings
          SET api_token_enc = $2, api_token_hint = $3, sandbox = $4,
              auth_mode = $5, webhook_secret = $6
        WHERE tenant_id = $1`,
      [DEMO_TENANT, saved.apiTokenEnc, saved.apiTokenHint, saved.sandbox, saved.authMode, saved.webhookSecret],
    );
  });
});

test("as credenciais de assinatura de um tenant não vazam para outro", async () => {
  const hint = randomUUID().slice(0, 4);
  await repo.upsertSettings(DEMO_TENANT, {
    apiTokenEnc: "v1.fake.fake.fake",
    apiTokenHint: hint,
    sandbox: true,
    authMode: "assinaturaTela-tokenEmail",
    webhookSecret: `webhook-${randomUUID()}`,
  });

  const mine = await repo.findSettings(DEMO_TENANT);
  assert.equal(mine?.apiTokenHint, hint, "o tenant dono lê a própria configuração");
  assert.ok(mine?.webhookSecret, "o segredo do webhook é persistido");

  const theirs = await repo.findSettings(OTHER_TENANT);
  assert.equal(theirs, null, "TENANT LEAKAGE: outro tenant não pode ler o token/segredo");
});

test("reconfigurar preserva o webhook_secret já registrado na ZapSign", async () => {
  const base = {
    apiTokenEnc: "v1.fake.fake.fake",
    apiTokenHint: "1111",
    sandbox: true,
    authMode: "assinaturaTela-tokenEmail",
  };
  await repo.upsertSettings(DEMO_TENANT, { ...base, webhookSecret: `webhook-${randomUUID()}` });
  const first = await repo.findSettings(DEMO_TENANT);

  // Trocar o modo de assinatura não pode invalidar o webhook já cadastrado no
  // provedor — o segredo novo seria rejeitado na chegada do callback.
  await repo.upsertSettings(DEMO_TENANT, {
    ...base,
    authMode: "assinaturaTela",
    webhookSecret: `webhook-${randomUUID()}`,
  });
  const second = await repo.findSettings(DEMO_TENANT);

  assert.equal(second?.webhookSecret, first?.webhookSecret);
  assert.equal(second?.authMode, "assinaturaTela", "os demais campos são atualizados");
});

test("um envelope criado no tenant demo não é visível por outro tenant", async () => {
  const contractId = await newContract();
  const docToken = `doc-${randomUUID()}`;

  const created = await repo.insertEnvelope(DEMO_TENANT, {
    contractId,
    version: 1,
    providerDocToken: docToken,
    authMode: "assinaturaTela-tokenEmail",
    sandbox: true,
    snapshot: { status: "pending" },
    signers: [
      {
        partyId: null,
        providerSignerToken: `signer-${randomUUID()}`,
        role: "LOCADOR",
        name: "Carlos Proprietário",
        email: "carlos.prop@example.com",
        signUrl: "https://app.zapsign.com.br/verificar/abc",
        status: "PENDENTE",
      },
    ],
  });

  try {
    assert.equal(created.signers.length, 1);

    const mine = await repo.findLatestEnvelope(DEMO_TENANT, contractId);
    assert.equal(mine?.id, created.id, "o tenant dono enxerga o próprio envelope");

    const theirs = await repo.findLatestEnvelope(OTHER_TENANT, contractId);
    assert.equal(theirs, null, "TENANT LEAKAGE: outro tenant não pode ver o envelope");

    const byToken = await repo.findEnvelopeByDocToken(OTHER_TENANT, docToken);
    assert.equal(
      byToken,
      null,
      "TENANT LEAKAGE: nem com o token do documento em mãos (rota de webhook)",
    );

    // Escrita cruzada: o UPDATE não pode alcançar a linha de outro tenant.
    await assert.rejects(
      repo.applyEnvelopeState(OTHER_TENANT, {
        envelopeId: created.id,
        status: "ASSINADO",
        snapshot: { status: "signed" },
        signers: [],
      }),
      /não encontrado/,
      "TENANT LEAKAGE: escrita cruzada não pode concluir",
    );

    const after = await repo.findLatestEnvelope(DEMO_TENANT, contractId);
    assert.equal(after?.status, "PENDENTE", "o envelope do dono segue intacto");
  } finally {
    await dropContract(contractId);
  }
});

test("applyEnvelopeState é idempotente: só a 1ª conclusão retorna justCompleted", async () => {
  const contractId = await newContract();
  const signerToken = `signer-${randomUUID()}`;
  const envelope = await repo.insertEnvelope(DEMO_TENANT, {
    contractId,
    version: 1,
    providerDocToken: `doc-${randomUUID()}`,
    authMode: "assinaturaTela-tokenEmail",
    sandbox: true,
    snapshot: {},
    signers: [
      {
        partyId: null,
        providerSignerToken: signerToken,
        role: "LOCATARIO",
        name: "Ana Lima",
        email: "ana.lima@example.com",
        signUrl: null,
        status: "PENDENTE",
      },
    ],
  });

  try {
    const state = {
      envelopeId: envelope.id,
      status: "ASSINADO",
      snapshot: { status: "signed" },
      signedStorageKey: "demo/key.pdf",
      signers: [
        {
          providerSignerToken: signerToken,
          status: "ASSINADO",
          signedAt: new Date().toISOString(),
        },
      ],
    };

    const first = await repo.applyEnvelopeState(DEMO_TENANT, state);
    assert.equal(first.justCompleted, true, "a 1ª aplicação conclui o envelope");
    assert.equal(first.envelope.status, "ASSINADO");
    assert.equal(first.envelope.signers[0]?.status, "ASSINADO");

    // Reprocessar o MESMO webhook não pode versionar/publicar de novo.
    const second = await repo.applyEnvelopeState(DEMO_TENANT, state);
    assert.equal(second.justCompleted, false, "reprocessar o mesmo evento é no-op");
    assert.equal(second.envelope.status, "ASSINADO");
  } finally {
    await dropContract(contractId);
  }
});
