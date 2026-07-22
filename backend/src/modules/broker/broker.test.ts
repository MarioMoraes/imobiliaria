import assert from "node:assert/strict";
import { test } from "node:test";
import { insertBroker, listBrokers } from "./broker.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * Um corretor de um tenant nunca pode ser visto por outro.
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";

test("um corretor criado no tenant demo não é visível por outro tenant", async () => {
  const created = await insertBroker(DEMO_TENANT, {
    name: `Corretor Isolamento ${Date.now()}`,
    commissionPercent: 5,
  });

  const visibleToDemo = await listBrokers(DEMO_TENANT);
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
