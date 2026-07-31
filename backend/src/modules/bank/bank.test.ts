import assert from "node:assert/strict";
import { test } from "node:test";
import { insertBank, listBanks } from "./bank.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * Um banco de um tenant nunca pode ser visto por outro.
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("bank")).id;
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";

test("um banco criado num tenant não é visível por outro tenant", async () => {
  const created = await insertBank(TENANT, {
    name: `Banco Isolamento ${Date.now()}`,
    favorite: false,
  });

  const visibleToDemo = await listBanks(TENANT);
  assert.ok(
    visibleToDemo.some((b) => b.id === created.id),
    "o tenant dono deve enxergar o próprio banco",
  );

  const visibleToOther = await listBanks(OTHER_TENANT);
  assert.ok(
    !visibleToOther.some((b) => b.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar o banco",
  );
});
