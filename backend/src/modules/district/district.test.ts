import assert from "node:assert/strict";
import { test } from "node:test";
import { insertDistrict, listDistricts } from "./district.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * Um bairro de um tenant nunca pode ser visto por outro.
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("district")).id;
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";

test("um bairro criado num tenant não é visível por outro tenant", async () => {
  const created = await insertDistrict(TENANT, {
    name: `Bairro Isolamento ${Date.now()}`,
  });

  const visibleToDemo = await listDistricts(TENANT);
  assert.ok(
    visibleToDemo.some((d) => d.id === created.id),
    "o tenant dono deve enxergar o próprio bairro",
  );

  const visibleToOther = await listDistricts(OTHER_TENANT);
  assert.ok(
    !visibleToOther.some((d) => d.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar o bairro",
  );
});
