import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { create, list, assertActive, update } from "./tenant.service.js";
import { createTrackedTenant, testSlug } from "../../testing/tenants.js";

/**
 * Testes do módulo tenant (nível plataforma). Requerem o banco containerizado:
 *   npm run infra:up
 * Rode com: npm test
 */

test("cria um tenant e ele aparece na listagem", async () => {
  const slug = testSlug();
  const created = await createTrackedTenant({ name: "Imobiliária Teste", slug, plan: "free" });

  assert.equal(created.slug, slug);
  assert.equal(created.status, "active");

  const all = await list();
  assert.ok(all.some((t) => t.id === created.id));
});

test("slug duplicado gera conflito (409)", async () => {
  const slug = testSlug();
  await createTrackedTenant({ name: "Primeira", slug, plan: "free" });

  await assert.rejects(
    () => create({ name: "Segunda", slug, plan: "free" }),
    /já está em uso/,
  );
});

test("a imobiliária troca o próprio slug (subdomínio)", async () => {
  const tenant = await createTrackedTenant({
    name: "Renomeia",
    slug: testSlug(),
    plan: "free",
  });

  const novo = testSlug();
  const updated = await update(tenant.id, { slug: novo });
  assert.equal(updated.slug, novo);
});

test("trocar o slug para um já usado gera conflito (409)", async () => {
  const ocupado = testSlug();
  await createTrackedTenant({ name: "Dona do slug", slug: ocupado, plan: "free" });
  const outra = await createTrackedTenant({
    name: "Outra",
    slug: testSlug(),
    plan: "free",
  });

  await assert.rejects(() => update(outra.id, { slug: ocupado }), /já está em uso/);
});

test("salvar o mesmo slug do próprio tenant não é conflito", async () => {
  const slug = testSlug();
  const tenant = await createTrackedTenant({ name: "Sem mudança", slug, plan: "free" });

  const updated = await update(tenant.id, { slug, name: "Sem mudança II" });
  assert.equal(updated.slug, slug);
});

test("assertActive permite tenant ativo e bloqueia tenant suspenso", async () => {
  const slug = testSlug();
  const tenant = await createTrackedTenant({ name: "Ativa", slug, plan: "free" });

  await assert.doesNotReject(() => assertActive(tenant.id));

  await update(tenant.id, { status: "suspended" });
  await assert.rejects(() => assertActive(tenant.id), /suspenso/);
});

test("assertActive permite tenant em trial", async () => {
  const slug = testSlug();
  const tenant = await createTrackedTenant({ name: "Trial", slug, plan: "free" });
  await update(tenant.id, { status: "trial" });
  await assert.doesNotReject(() => assertActive(tenant.id));
});

test("assertActive bloqueia tenant inexistente", async () => {
  await assert.rejects(() => assertActive(randomUUID()), /não encontrado/);
});
