import assert from "node:assert/strict";
import { test } from "node:test";
import { insertDistrict, listDistricts } from "./district.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * Um bairro de um tenant nunca pode ser visto por outro.
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";

test("um bairro criado no tenant demo não é visível por outro tenant", async () => {
  const created = await insertDistrict(DEMO_TENANT, {
    name: `Bairro Isolamento ${Date.now()}`,
  });

  const visibleToDemo = await listDistricts(DEMO_TENANT);
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
