import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { withTenant } from "../../shared/db.js";
import { onboarding } from "./auth.service.js";
import { trackTenant } from "../../testing/tenants.js";
import type { OnboardingInput } from "./auth.schema.js";

/**
 * Testes do MOD-AUTH-04 (onboarding) e isolamento das tabelas de usuários.
 * Requerem o banco containerizado: `npm run infra:up`. Rode com `npm test`.
 */

function makeInput(overrides: Partial<OnboardingInput["studio"]> = {}): OnboardingInput {
  const rand = randomUUID().slice(0, 8);
  return {
    studio: {
      name: "Nova Imobiliária",
      cnpj: String(Math.floor(Math.random() * 1e14)).padStart(14, "0"),
      slug: `nova-${rand}`,
      ...overrides,
    },
    planId: "free",
    admin: { email: `admin-${rand}@nova.com`, fullName: "Admin Nova" },
  };
}

test("onboarding cria tenant em trial e primeiro usuário ADMIN", async () => {
  const input = makeInput();
  const { tenant, user } = await onboarding(input);
  trackTenant(tenant);

  assert.equal(tenant.status, "trial");
  assert.equal(tenant.slug, input.studio.slug);
  assert.equal(tenant.cnpj, input.studio.cnpj);
  assert.equal(user.tenantId, tenant.id);
  assert.equal(user.email, input.admin?.email);
  assert.deepEqual(user.roles, ["ADMIN"]);
  assert.equal(user.status, "active");
});

test("onboarding com CNPJ já cadastrado gera conflito (409 ERR_AUTH_004)", async () => {
  const cnpj = String(Math.floor(Math.random() * 1e14)).padStart(14, "0");
  trackTenant((await onboarding(makeInput({ cnpj }))).tenant);

  await assert.rejects(
    () => onboarding(makeInput({ cnpj })),
    (err: unknown) =>
      err instanceof Error &&
      /CNPJ já cadastrado/.test(err.message) &&
      (err as { code?: string }).code === "ERR_AUTH_004",
  );
});

test("ISOLAMENTO: o usuário admin de um tenant não é visível por outro tenant", async () => {
  const { tenant, user } = await onboarding(makeInput());
  trackTenant(tenant);

  // Dono enxerga o próprio usuário.
  const visibleToOwner = await withTenant(tenant.id, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE id = $1",
      [user.id],
    );
    return rows;
  });
  assert.equal(visibleToOwner.length, 1, "o tenant dono deve enxergar o próprio usuário");

  // Outro tenant não enxerga nada.
  const other = "00000000-0000-0000-0000-0000000000ff";
  const visibleToOther = await withTenant(other, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE id = $1",
      [user.id],
    );
    return rows;
  });
  assert.equal(visibleToOther.length, 0, "TENANT LEAKAGE: outro tenant não pode enxergar o usuário");
});
