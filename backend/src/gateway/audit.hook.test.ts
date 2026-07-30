import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { listAuditLogs } from "../modules/audit/audit.repository.js";
import { auditQuery, type AuditLog } from "../modules/audit/audit.schema.js";

/**
 * Captura automática da trilha (gateway/audit.hook.ts). É o teste que garante
 * o essencial do desenho: um módulo qualquer entra na auditoria sem ter escrito
 * uma linha de código para isso.
 *
 * Depende da infra de pé (`npm run infra:up`).
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";

let app: FastifyInstance;

before(async () => {
  app = await buildApp();
});

after(async () => {
  await app.close();
});

/**
 * O registro é disparado depois da resposta (sem `await`, para não custar
 * latência ao usuário), então a leitura tenta algumas vezes antes de desistir.
 */
async function waitForLog(entityId: string): Promise<AuditLog | undefined> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const page = await listAuditLogs(DEMO_TENANT, auditQuery.parse({ entityId, limit: 5 }));
    if (page.items[0]) return page.items[0];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

test("criar um banco entra na trilha sem o módulo saber da auditoria", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/v1/banks",
    payload: { name: `Banco Auditado ${Date.now()}` },
    headers: { "x-tenant-id": DEMO_TENANT, "x-dev-roles": "ADMIN" },
  });
  assert.equal(created.statusCode, 201);
  const id = created.json().data.id as string;

  const log = await waitForLog(id);
  assert.ok(log, "a criação tem que virar linha de auditoria");
  assert.equal(log.action, "bank.created");
  assert.equal(log.entity, "bank");
  assert.equal(log.status, "OK");
  assert.ok(log.ipAddress, "o IP de origem é obrigatório (PRD 01 seção 9)");
  assert.equal(
    (log.payload as Record<string, unknown>)["name"],
    created.json().data.name,
    "o corpo enviado fica no payload",
  );

  const removed = await app.inject({
    method: "DELETE",
    url: `/v1/banks/${id}`,
    headers: { "x-tenant-id": DEMO_TENANT, "x-dev-roles": "ADMIN" },
  });
  assert.equal(removed.statusCode, 200);

  // A exclusão gera a SEGUNDA linha — e a primeira continua lá (append-only).
  for (let attempt = 0; attempt < 20; attempt++) {
    const page = await listAuditLogs(DEMO_TENANT, auditQuery.parse({ entityId: id, limit: 5 }));
    if (page.total >= 2) {
      assert.deepEqual(
        page.items.map((l) => l.action).sort(),
        ["bank.created", "bank.deleted"],
        "criação e exclusão convivem na trilha",
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("a exclusão não entrou na trilha");
});

test("tentativa barrada pelo papel entra como DENIED", async () => {
  const denied = await app.inject({
    method: "POST",
    url: "/v1/banks",
    payload: { name: "Banco que o corretor não cria" },
    // CORRETOR não tem finance:write.
    headers: { "x-tenant-id": DEMO_TENANT, "x-dev-roles": "CORRETOR" },
  });
  assert.equal(denied.statusCode, 403);

  for (let attempt = 0; attempt < 20; attempt++) {
    const page = await listAuditLogs(
      DEMO_TENANT,
      auditQuery.parse({ action: "bank.created", status: "DENIED", limit: 1 }),
    );
    if (page.items[0]) {
      assert.equal(page.items[0].status, "DENIED");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("a recusa por papel tem que aparecer na trilha");
});

test("leitura não polui a trilha", async () => {
  const before = await listAuditLogs(DEMO_TENANT, auditQuery.parse({ limit: 1 }));
  const res = await app.inject({
    method: "GET",
    url: "/v1/banks",
    headers: { "x-tenant-id": DEMO_TENANT, "x-dev-roles": "ADMIN" },
  });
  assert.equal(res.statusCode, 200);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const after = await listAuditLogs(DEMO_TENANT, auditQuery.parse({ limit: 1 }));
  assert.equal(after.total, before.total, "um GET não gera registro");
});
