import assert from "node:assert/strict";
import { test } from "node:test";
import { insertBroker, listBrokers } from "./broker.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * Um corretor de um tenant nunca pode ser visto por outro.
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("broker")).id;
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";

test("um corretor criado num tenant não é visível por outro tenant", async () => {
  const created = await insertBroker(TENANT, {
    name: `Corretor Isolamento ${Date.now()}`,
    commissionPercent: 5,
  });

  const visibleToDemo = await listBrokers(TENANT);
  assert.ok(
    visibleToDemo.some((b) => b.id === created.id),
    "o tenant dono deve enxergar o próprio corretor",
  );

  const visibleToOther = await listBrokers(OTHER_TENANT);
  assert.ok(
    !visibleToOther.some((b) => b.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar o corretor",
  );
});
