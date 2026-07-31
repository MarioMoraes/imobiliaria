import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AppError } from "../../shared/errors.js";
import { createTestTenant } from "../../testing/tenants.js";
import * as service from "./employee.service.js";
import { inviteHtml, inviteText } from "./invite-email.js";

/**
 * MOD-FUNC — funcionários. Inclui o teste de ISOLAMENTO multi-tenant
 * obrigatório (SPEC 3.1 e 14) e a regra do último ADMIN (RN-01).
 * Requer a infra de pé (npm run infra:up).
 */

/** Gera um CPF válido (dígitos verificadores) a partir de uma base aleatória. */
function makeValidCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const digits = [...base];
  for (let check = 9; check < 11; check++) {
    let sum = 0;
    for (let i = 0; i < check; i++) sum += digits[i]! * (check + 1 - i);
    digits.push(((sum * 10) % 11) % 10);
  }
  return digits.join("");
}

async function freshTenant(name: string) {
  return createTestTenant(name);
}

function newEmployee(overrides: Partial<{ roles: ("ADMIN" | "GESTOR" | "FINANCEIRO")[] }> = {}) {
  const uniq = randomUUID().slice(0, 8);
  return {
    fullName: "Colaborador Teste",
    cpf: makeValidCpf(),
    email: `func-${uniq}@t.com`,
    position: "Recepção",
    roles: overrides.roles ?? (["FINANCEIRO"] as ("ADMIN" | "GESTOR" | "FINANCEIRO")[]),
  };
}

test("ISOLAMENTO: funcionário de um tenant não é visível por outro", async () => {
  const a = await freshTenant("Func-A");
  const b = await freshTenant("Func-B");

  const created = await service.create(a.id, newEmployee());

  const visibleToA = await service.list(a.id);
  assert.ok(visibleToA.some((e) => e.id === created.id), "o dono deve ver o funcionário");

  const visibleToB = await service.list(b.id);
  assert.ok(
    !visibleToB.some((e) => e.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode ver o funcionário",
  );
});

test("cria funcionário vinculado a user+papel e recupera por id", async () => {
  const t = await freshTenant("Func-CRUD");
  const created = await service.create(t.id, newEmployee({ roles: ["GESTOR"] }));

  assert.equal(created.accessStatus, "ATIVO");
  assert.deepEqual(created.roles, ["GESTOR"]);
  assert.ok(created.userId, "deve provisionar um user vinculado");
  // Sem Clerk configurado (dev), o membro nasce ativo, sem convite por e-mail.
  assert.equal(created.userStatus, "active");

  const fetched = await service.getById(t.id, created.id);
  assert.equal(fetched.id, created.id);
  assert.equal(fetched.email, created.email);
});

test("CPF duplicado no mesmo tenant gera conflito (ERR_FUNC_004)", async () => {
  const t = await freshTenant("Func-Dup");
  const first = newEmployee();
  await service.create(t.id, first);

  await assert.rejects(
    () => service.create(t.id, { ...newEmployee(), cpf: first.cpf }),
    (err) => err instanceof AppError && err.code === "ERR_FUNC_004",
  );
});

test("último ADMIN ativo não pode ser revogado (ERR_FUNC_005)", async () => {
  const t = await freshTenant("Func-Admin");
  const admin1 = await service.create(t.id, newEmployee({ roles: ["ADMIN"] }));

  await assert.rejects(
    () => service.changeAccess(t.id, admin1.id, "REVOGADO"),
    (err) => err instanceof AppError && err.code === "ERR_FUNC_005",
  );

  // Com um segundo ADMIN, a revogação do primeiro passa a ser permitida.
  await service.create(t.id, newEmployee({ roles: ["ADMIN"] }));
  const revoked = await service.changeAccess(t.id, admin1.id, "REVOGADO");
  assert.equal(revoked.accessStatus, "REVOGADO");
});

test("rebaixar o único ADMIN também é bloqueado (ERR_FUNC_005)", async () => {
  const t = await freshTenant("Func-Downgrade");
  const admin = await service.create(t.id, newEmployee({ roles: ["ADMIN"] }));

  await assert.rejects(
    () => service.update(t.id, admin.id, { roles: ["GESTOR"] }),
    (err) => err instanceof AppError && err.code === "ERR_FUNC_005",
  );
});

test("atualiza cargo e papéis do funcionário", async () => {
  const t = await freshTenant("Func-Update");
  const created = await service.create(t.id, newEmployee({ roles: ["FINANCEIRO"] }));

  const updated = await service.update(t.id, created.id, {
    position: "Gerente de locação",
    roles: ["GESTOR", "FINANCEIRO"],
    hiredAt: "2026-01-15",
  });

  assert.equal(updated.position, "Gerente de locação");
  assert.deepEqual([...updated.roles].sort(), ["FINANCEIRO", "GESTOR"]);
  assert.equal(updated.hiredAt, "2026-01-15");
});

test("exclui o funcionário e a identidade vinculada", async () => {
  const t = await freshTenant("Func-Delete");
  const created = await service.create(t.id, newEmployee());

  await service.remove(t.id, created.id);

  assert.ok(!(await service.list(t.id)).some((e) => e.id === created.id));
  await assert.rejects(
    () => service.getById(t.id, created.id),
    (err) => err instanceof AppError && err.code === "ERR_FUNC_001",
  );
});

test("excluir o último ADMIN ativo é bloqueado (ERR_FUNC_005)", async () => {
  const t = await freshTenant("Func-Delete-Admin");
  const admin = await service.create(t.id, newEmployee({ roles: ["ADMIN"] }));

  await assert.rejects(
    () => service.remove(t.id, admin.id),
    (err) => err instanceof AppError && err.code === "ERR_FUNC_005",
  );

  // Com um segundo ADMIN, a exclusão do primeiro passa a ser permitida.
  await service.create(t.id, newEmployee({ roles: ["ADMIN"] }));
  await service.remove(t.id, admin.id);
  assert.ok(!(await service.list(t.id)).some((e) => e.id === admin.id));
});

test("excluir funcionário inexistente é 404 (ERR_FUNC_001)", async () => {
  const t = await freshTenant("Func-Delete-404");

  await assert.rejects(
    () => service.remove(t.id, randomUUID()),
    (err) => err instanceof AppError && err.code === "ERR_FUNC_001",
  );
});

test("reenviar convite de membro já ativo é rejeitado (ERR_FUNC_007)", async () => {
  // Tenant de teste não tem clerk_org_id, então o membro nasce 'active'.
  const t = await freshTenant("Func-Resend");
  const member = await service.create(t.id, newEmployee());

  await assert.rejects(
    () => service.resendInvite(t.id, member.id),
    (err) => err instanceof AppError && err.code === "ERR_FUNC_007",
  );
});

test("reenviar convite de funcionário inexistente é 404 (ERR_FUNC_001)", async () => {
  const t = await freshTenant("Func-Resend-404");

  await assert.rejects(
    () => service.resendInvite(t.id, randomUUID()),
    (err) => err instanceof AppError && err.code === "ERR_FUNC_001",
  );
});

test("o e-mail de convite escapa HTML do nome e leva o link de aceite", () => {
  const url = "https://acme.accounts.dev/v1/tickets/accept?ticket=abc";
  const html = inviteHtml({
    tenantName: 'Imobiliária "A" & Cia',
    memberName: "<script>alert(1)</script>",
    acceptUrl: url,
  });

  assert.ok(!html.includes("<script>"), "nome do membro deve ser escapado");
  assert.ok(html.includes("&amp;"), "e-comercial do tenant deve ser escapado");
  assert.ok(html.includes(url), "o link de aceite precisa estar no corpo");
  assert.ok(inviteText({ tenantName: "X", memberName: "Y", acceptUrl: url }).includes(url));
});
