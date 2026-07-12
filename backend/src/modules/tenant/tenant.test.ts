import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { create, list, assertActive, update } from "./tenant.service.js";

/**
 * Testes do módulo tenant (nível plataforma). Requerem o banco containerizado:
 *   npm run infra:up
 * Rode com: npm test
 */

test("cria um tenant e ele aparece na listagem", async () => {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const created = await create({ name: "Imobiliária Teste", slug, plan: "free" });

  assert.equal(created.slug, slug);
  assert.equal(created.status, "active");

  const all = await list();
  assert.ok(all.some((t) => t.id === created.id));
});

test("slug duplicado gera conflito (409)", async () => {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  await create({ name: "Primeira", slug, plan: "free" });

  await assert.rejects(
    () => create({ name: "Segunda", slug, plan: "free" }),
    /já está em uso/,
  );
});

test("assertActive permite tenant ativo e bloqueia tenant suspenso", async () => {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const tenant = await create({ name: "Ativa", slug, plan: "free" });

  await assert.doesNotReject(() => assertActive(tenant.id));

  await update(tenant.id, { status: "suspended" });
  await assert.rejects(() => assertActive(tenant.id), /suspenso/);
});

test("assertActive permite tenant em trial", async () => {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const tenant = await create({ name: "Trial", slug, plan: "free" });
  await update(tenant.id, { status: "trial" });
  await assert.doesNotReject(() => assertActive(tenant.id));
});

test("assertActive bloqueia tenant inexistente", async () => {
  await assert.rejects(() => assertActive(randomUUID()), /não encontrado/);
});
