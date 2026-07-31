import assert from "node:assert/strict";
import { test } from "node:test";
import { insertEvent, listEvents } from "./event.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * Um evento de um tenant nunca pode ser visto por outro.
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("event")).id;
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";

test("um evento criado num tenant não é visível por outro tenant", async () => {
  const created = await insertEvent(TENANT, {
    name: `Evento Isolamento ${Date.now()}`,
    kind: "DEBITO",
    interestPercent: 1,
    judicialInterestPercent: 1,
    penaltyPercent: 2,
    appliesAdminFee: true,
  });

  const visibleToDemo = await listEvents(TENANT);
  assert.ok(
    visibleToDemo.some((e) => e.id === created.id),
    "o tenant dono deve enxergar o próprio evento",
  );

  const visibleToOther = await listEvents(OTHER_TENANT);
  assert.ok(
    !visibleToOther.some((e) => e.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar o evento",
  );
});
