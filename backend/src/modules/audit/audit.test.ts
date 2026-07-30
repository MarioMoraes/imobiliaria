import assert from "node:assert/strict";
import { test } from "node:test";
import { withPlatform, withTenant } from "../../shared/db.js";
import { insertAuditLog, listAuditLogs } from "./audit.repository.js";
import { auditQuery } from "./audit.schema.js";
import { record } from "./audit.service.js";
import { describeAction } from "./audit.actions.js";
import { redact } from "./audit.redact.js";

/**
 * Trilha de auditoria (MOD-AUTH-07 / SPEC 9.4).
 *
 * Os dois primeiros testes são de infraestrutura e precisam do banco de pé
 * (`npm run infra:up`): isolamento entre tenants (obrigatório no CI — SPEC 3.1)
 * e imutabilidade do registro. Os demais são puros.
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

const query = (over: Record<string, unknown> = {}) => auditQuery.parse(over);

test("um registro do tenant demo não é visível por outro tenant", async () => {
  const created = await insertAuditLog(DEMO_TENANT, {
    action: "property.created",
    entity: "property",
    entityId: "teste-isolamento",
  });

  const visibleToDemo = await listAuditLogs(DEMO_TENANT, query({ limit: 100 }));
  assert.ok(
    visibleToDemo.items.some((log) => log.id === created.id),
    "o tenant dono deve enxergar o próprio registro",
  );

  const visibleToOther = await listAuditLogs(OTHER_TENANT, query({ limit: 100 }));
  assert.ok(
    !visibleToOther.items.some((log) => log.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar a trilha",
  );
});

test("o registro é imutável: não se edita, e o recente não se apaga", async () => {
  const created = await insertAuditLog(DEMO_TENANT, {
    action: "property.updated",
    entity: "property",
    entityId: "teste-imutabilidade",
  });

  // UPDATE: `app_user` não tem o privilégio (nem existe policy de UPDATE).
  await assert.rejects(
    () =>
      withTenant(DEMO_TENANT, (client) =>
        client.query("UPDATE audit_logs SET action = 'forjado' WHERE id = $1", [created.id]),
      ),
    /permission denied|permissão negada/i,
    "UPDATE na trilha tem que ser recusado pelo banco",
  );

  // DELETE: o privilégio existe (para o expurgo de retenção), mas a policy só
  // alcança linhas com mais de 12 meses — a recém-criada é indeletável.
  const removed = await withPlatform(async (client) => {
    const { rowCount } = await client.query("DELETE FROM audit_logs WHERE id = $1", [
      created.id,
    ]);
    return rowCount ?? 0;
  });
  assert.equal(removed, 0, "linha recente não pode ser apagada nem pela plataforma");

  const stillThere = await listAuditLogs(
    DEMO_TENANT,
    query({ entityId: "teste-imutabilidade", limit: 100 }),
  );
  assert.ok(stillThere.items.some((log) => log.id === created.id));
  assert.equal(stillThere.items[0]?.action, "property.updated", "a ação não pode ter mudado");
});

test("record() nunca deixa um segredo chegar ao banco", async () => {
  await record({
    tenantId: DEMO_TENANT,
    action: "config.integrations.updated",
    entity: "config",
    entityId: "teste-redacao",
    payload: { apiKey: "chave-secreta-do-asaas", walletId: "abc", cpf: "12345678901" },
  });

  const found = await listAuditLogs(
    DEMO_TENANT,
    query({ entityId: "teste-redacao", limit: 1 }),
  );
  const payload = found.items[0]?.payload as Record<string, unknown> | undefined;
  assert.ok(payload, "o registro tem que existir");
  assert.equal(payload["apiKey"], "[redigido]");
  assert.equal(payload["cpf"], "***901", "documento pessoal fica parcial");
  assert.equal(payload["walletId"], "abc", "o que não é segredo continua legível");
});

test("record() não derruba o chamador quando a gravação falha", async () => {
  // Tenant inexistente: o INSERT viola a FK. `record` engole e segue.
  await record({
    tenantId: OTHER_TENANT,
    action: "property.created",
    entity: "property",
  });
});

test("a ação é derivada da rota, com exceções para os nomes dos PRDs", () => {
  assert.deepEqual(describeAction("POST", "/v1/properties"), {
    action: "property.created",
    entity: "property",
  });
  assert.deepEqual(describeAction("PATCH", "/v1/properties/:id"), {
    action: "property.updated",
    entity: "property",
  });
  assert.deepEqual(describeAction("DELETE", "/v1/properties/:id/photos/:photoId"), {
    action: "property.photo_deleted",
    entity: "property",
  });
  assert.deepEqual(describeAction("POST", "/v1/persons/:id/addresses"), {
    action: "person.address_created",
    entity: "person",
  });

  // Exceções: o nome vem do negócio, não do verbo HTTP.
  assert.deepEqual(describeAction("POST", "/v1/receivables/:id/settle"), {
    action: "payment.received",
    entity: "receivable",
  });
  assert.deepEqual(describeAction("PATCH", "/v1/users/:id/role"), {
    action: "role.changed",
    entity: "user",
  });
  assert.deepEqual(describeAction("DELETE", "/v1/documents/:id"), {
    action: "document.purged",
    entity: "document",
  });

  // Fora da trilha.
  assert.equal(describeAction("GET", "/v1/properties"), null, "leitura não é auditada aqui");
  assert.equal(describeAction("POST", "/v1/ai/chat"), null, "conversa fica em agent_tool_calls");
  assert.equal(describeAction("POST", "/v1/contracts/preview"), null, "prévia não muda nada");
  assert.equal(describeAction("POST", "/webhooks/asaas/:tenantId"), null, "fora de /v1");
});

test("a redação corta binário e trunca payload gigante", () => {
  const redigido = redact({
    dataUrl: "data:image/png;base64,AAAA",
    token: "abc",
    nested: { password: "x", ok: 1 },
  }) as Record<string, unknown>;
  assert.match(String(redigido["dataUrl"]), /^\[binário \d+ bytes\]$/);
  assert.equal(redigido["token"], "[redigido]");
  assert.equal((redigido["nested"] as Record<string, unknown>)["password"], "[redigido]");
  assert.equal((redigido["nested"] as Record<string, unknown>)["ok"], 1);

  const gigante = redact({ items: Array.from({ length: 500 }, (_, i) => ({ i })) });
  assert.ok(Array.isArray((gigante as Record<string, unknown>)["items"]));

  assert.equal(redact(undefined), null);
});
