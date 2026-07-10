import assert from "node:assert/strict";
import { test } from "node:test";
import { listGuarantors, insertGuarantor } from "./guarantor.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC 3.1 e 14) — obrigatório no CI.
 * Depende da infra containerizada (npm run infra:up) e do seed (tenant demo).
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";

test("um fiador criado no tenant demo não é visível por outro tenant", async () => {
  const created = await insertGuarantor(DEMO_TENANT, {
    personType: "PF",
    cpfCnpj: `iso-${Date.now()}`,
    fullName: "Fiador de teste de isolamento",
    nationality: "BRASILEIRA",
    addresses: [{ kind: "RESIDENCIAL", city: "São Paulo", state: "SP" }],
  });

  const visibleToDemo = await listGuarantors(DEMO_TENANT);
  assert.ok(
    visibleToDemo.some((g) => g.id === created.id),
    "o tenant dono deve enxergar o próprio fiador",
  );

  const visibleToOther = await listGuarantors(OTHER_TENANT);
  assert.ok(
    !visibleToOther.some((g) => g.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar o fiador",
  );
});
