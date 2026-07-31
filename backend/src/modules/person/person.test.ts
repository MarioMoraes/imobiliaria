import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AppError } from "../../shared/errors.js";
import { createTestTenant } from "../../testing/tenants.js";
import * as service from "./person.service.js";
import type { CreatePersonInput } from "./person.schema.js";

/**
 * MOD-PESSOA — cadastro unificado (locador/locatário/fiador). Inclui o
 * teste de ISOLAMENTO multi-tenant obrigatório (SPEC 3.1 e 14), deduplicação,
 * contato obrigatório, papéis, endereços, perfil de busca e máquina de estados.
 * Requer a infra de pé (npm run infra:up).
 */

async function freshTenant(name: string) {
  return createTestTenant(name);
}

function newPerson(overrides: Partial<CreatePersonInput> = {}): CreatePersonInput {
  const uniq = randomUUID().slice(0, 8);
  return {
    roles: ["LOCATARIO"],
    personType: "PF",
    fullName: "Pessoa Teste",
    nationality: "BRASILEIRA",
    phone: `1199${uniq.replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}`,
    source: "WHATSAPP",
    addresses: [],
    ...overrides,
  } as CreatePersonInput;
}

test("ISOLAMENTO: pessoa de um tenant não é visível por outro", async () => {
  const a = await freshTenant("Pes-A");
  const b = await freshTenant("Pes-B");

  const created = await service.create(a.id, newPerson());

  const visibleToA = await service.list(a.id, {});
  assert.ok(visibleToA.some((p) => p.id === created.id), "o dono deve ver a pessoa");

  const visibleToB = await service.list(b.id, {});
  assert.ok(
    !visibleToB.some((p) => p.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode ver a pessoa",
  );
  await assert.rejects(
    () => service.getById(b.id, created.id),
    (err) => err instanceof AppError && err.code === "ERR_PESSOA_001",
  );
});

test("cria pessoa com múltiplos papéis e filtra por papel", async () => {
  const t = await freshTenant("Pes-Roles");
  const created = await service.create(t.id, newPerson({ roles: ["LOCADOR", "FIADOR"] }));
  assert.deepEqual(created.roles.sort(), ["FIADOR", "LOCADOR"]);

  const asLocador = await service.list(t.id, { role: "LOCADOR" });
  assert.ok(asLocador.some((p) => p.id === created.id), "deve aparecer no filtro LOCADOR");

  const asLocatario = await service.list(t.id, { role: "LOCATARIO" });
  assert.ok(!asLocatario.some((p) => p.id === created.id), "não deve aparecer no filtro LOCATARIO");
});

test("ficha completa (cônjuge + banco + endereço) é persistida", async () => {
  const t = await freshTenant("Pes-Ficha");
  const created = await service.create(
    t.id,
    newPerson({
      roles: ["LOCADOR"],
      maritalStatus: "CASADO",
      spouseName: "Cônjuge Teste",
      bank: "001",
      agency: "1234",
      account: "56789-0",
      addresses: [{ kind: "RESIDENCIAL", city: "São Paulo", state: "SP" }],
    }),
  );
  assert.equal(created.maritalStatus, "CASADO");
  assert.equal(created.spouseName, "Cônjuge Teste");
  assert.equal(created.bank, "001");
  assert.equal(created.addresses.length, 1);
  assert.equal(created.addresses[0]!.city, "São Paulo");
});

test("sem contato (email/telefone) gera 422 ERR_PESSOA_002", async () => {
  const t = await freshTenant("Pes-NoContact");
  await assert.rejects(
    () => service.create(t.id, { roles: ["LOCADOR"], fullName: "Sem Contato", personType: "PF", nationality: "BRASILEIRA", source: "MANUAL", addresses: [] } as never),
    (err) => err instanceof AppError && err.code === "ERR_PESSOA_002",
  );
});

test("dedup por telefone gera 409 ERR_PESSOA_004 com existingId", async () => {
  const t = await freshTenant("Pes-Dedup");
  const first = newPerson();
  const created = await service.create(t.id, first);

  await assert.rejects(
    () => service.create(t.id, newPerson({ phone: first.phone })),
    (err) =>
      err instanceof AppError &&
      err.code === "ERR_PESSOA_004" &&
      (err.details as { existingId: string }).existingId === created.id,
  );
});

test("transição manual para INQUILINO é bloqueada (422 ERR_PESSOA_005)", async () => {
  const t = await freshTenant("Pes-Stage");
  const p = await service.create(t.id, newPerson());

  await assert.rejects(
    () => service.update(t.id, p.id, { stage: "INQUILINO" }),
    (err) => err instanceof AppError && err.code === "ERR_PESSOA_005",
  );

  const promoted = await service.update(t.id, p.id, { stage: "CLIENTE" });
  assert.equal(promoted.stage, "CLIENTE");
});

test("interações são append-only; inativação = soft delete", async () => {
  const t = await freshTenant("Pes-Timeline");
  const p = await service.create(t.id, newPerson());

  const withInteraction = await service.addInteraction(t.id, p.id, {
    channel: "WHATSAPP",
    actor: "IA",
    summary: "Primeiro contato pelo bot",
  });
  assert.equal(withInteraction.interactions.length, 1);
  assert.equal(withInteraction.interactions[0]!.summary, "Primeiro contato pelo bot");

  const inactivated = await service.inactivate(t.id, p.id);
  assert.equal(inactivated.stage, "INATIVO");
  assert.equal(inactivated.status, "inactive");

  const listed = await service.list(t.id, {});
  assert.ok(!listed.some((x) => x.id === p.id), "inativada não aparece na listagem");
  assert.equal((await service.getById(t.id, p.id)).id, p.id, "ficha continua acessível");
});

test("edição: endereço e perfil de busca são upsert (não duplicam)", async () => {
  const t = await freshTenant("Pes-Edit");
  const p = await service.create(
    t.id,
    newPerson({
      addresses: [{ kind: "RESIDENCIAL", city: "Belo Horizonte", state: "MG" }],
      searchProfile: { intent: "LOCACAO", propertyTypes: [], districts: ["Centro"] },
    }),
  );

  const updated = await service.update(t.id, p.id, { fullName: "Nome Editado", rg: null });
  assert.equal(updated.fullName, "Nome Editado");
  assert.equal(updated.rg, null);

  // Reenviar o mesmo bloco (o que a edição na UI faz) substitui, não acumula.
  const readdressed = await service.addAddress(t.id, p.id, {
    kind: "RESIDENCIAL",
    city: "Contagem",
    state: "MG",
  });
  assert.equal(readdressed.addresses.length, 1);
  assert.equal(readdressed.addresses[0]!.city, "Contagem");

  const reprofiled = await service.addSearchProfile(t.id, p.id, {
    intent: "LOCACAO",
    propertyTypes: [],
    districts: ["Savassi"],
  });
  assert.equal(reprofiled.searchProfiles.length, 1);
  assert.deepEqual(reprofiled.searchProfiles[0]!.districts, ["Savassi"]);
});
