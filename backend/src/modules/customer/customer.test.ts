import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AppError } from "../../shared/errors.js";
import { create as createTenant } from "../tenant/tenant.service.js";
import * as service from "./customer.service.js";

/**
 * MOD-CLIENTE — clientes. Inclui o teste de ISOLAMENTO multi-tenant obrigatório
 * (SPEC 3.1 e 14), deduplicação, contato obrigatório, transição de stage e
 * append de perfil/interação. Requer a infra de pé (npm run infra:up).
 */

async function freshTenant(name: string) {
  return createTenant({ name, slug: `t-${randomUUID().slice(0, 8)}`, plan: "free" });
}

function newLead(overrides: Record<string, unknown> = {}) {
  const uniq = randomUUID().slice(0, 8);
  return {
    fullName: "Cliente Teste",
    phone: `1199${uniq.replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}`,
    source: "WHATSAPP" as const,
    ...overrides,
  };
}

test("ISOLAMENTO: cliente de um tenant não é visível por outro", async () => {
  const a = await freshTenant("Cli-A");
  const b = await freshTenant("Cli-B");

  const created = await service.create(a.id, newLead());

  const visibleToA = await service.list(a.id, {});
  assert.ok(visibleToA.some((c) => c.id === created.id), "o dono deve ver o cliente");

  const visibleToB = await service.list(b.id, {});
  assert.ok(
    !visibleToB.some((c) => c.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode ver o cliente",
  );
  await assert.rejects(
    () => service.getById(b.id, created.id),
    (err) => err instanceof AppError && err.code === "ERR_CLIENTE_001",
  );
});

test("cria lead (stage=LEAD) com perfil de busca embutido", async () => {
  const t = await freshTenant("Cli-Create");
  const created = await service.create(
    t.id,
    newLead({
      searchProfile: { intent: "LOCACAO", maxPriceCents: 300000, propertyTypes: ["APTO"], districts: ["Centro"] },
    }),
  );
  assert.equal(created.stage, "LEAD");
  assert.equal(created.searchProfiles.length, 1);
  assert.equal(created.searchProfiles[0]!.intent, "LOCACAO");
});

test("sem contato (email/telefone) gera 422 ERR_CLIENTE_002", async () => {
  const t = await freshTenant("Cli-NoContact");
  await assert.rejects(
    () => service.create(t.id, { fullName: "Sem Contato", source: "MANUAL" } as never),
    (err) => err instanceof AppError && err.code === "ERR_CLIENTE_002",
  );
});

test("dedup por telefone gera 409 ERR_CLIENTE_004 com existingId", async () => {
  const t = await freshTenant("Cli-Dedup");
  const first = newLead();
  const created = await service.create(t.id, first);

  await assert.rejects(
    () => service.create(t.id, { ...newLead(), phone: first.phone }),
    (err) =>
      err instanceof AppError &&
      err.code === "ERR_CLIENTE_004" &&
      (err.details as { existingId: string }).existingId === created.id,
  );
});

test("transição manual para INQUILINO é bloqueada (422 ERR_CLIENTE_002)", async () => {
  const t = await freshTenant("Cli-Stage");
  const c = await service.create(t.id, newLead());

  await assert.rejects(
    () => service.update(t.id, c.id, { stage: "INQUILINO" }),
    (err) => err instanceof AppError && err.code === "ERR_CLIENTE_002",
  );

  // LEAD → CLIENTE é permitido.
  const promoted = await service.update(t.id, c.id, { stage: "CLIENTE" });
  assert.equal(promoted.stage, "CLIENTE");
});

test("interações são append-only e aparecem na timeline; inativação = soft delete", async () => {
  const t = await freshTenant("Cli-Timeline");
  const c = await service.create(t.id, newLead());

  const withInteraction = await service.addInteraction(t.id, c.id, {
    channel: "WHATSAPP",
    actor: "IA",
    summary: "Primeiro contato pelo bot",
  });
  assert.equal(withInteraction.interactions.length, 1);
  assert.equal(withInteraction.interactions[0]!.summary, "Primeiro contato pelo bot");

  const inactivated = await service.inactivate(t.id, c.id);
  assert.equal(inactivated.stage, "INATIVO");
});
