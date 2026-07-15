import assert from "node:assert/strict";
import { test } from "node:test";
import {
  insertCondominium,
  listCondominiums,
} from "./condominium.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * Garante que um condomínio de um tenant nunca vaza para outro. Depende do
 * banco containerizado (`npm run infra:up`) e do seed em init.sql.
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

test("um condomínio criado no tenant demo não é visível por outro tenant", async () => {
  const created = await insertCondominium(DEMO_TENANT, {
    name: `Condomínio Isolamento ${Date.now()}`,
    adminFeePercent: 10,
    adminFeeFixedCents: 0,
    interestPercent: 1,
    penaltyPercent: 2,
  });

  const visibleToDemo = await listCondominiums(DEMO_TENANT);
  assert.ok(
    visibleToDemo.some((c) => c.id === created.id),
    "o tenant dono deve enxergar o próprio condomínio",
  );

  const visibleToOther = await listCondominiums(OTHER_TENANT);
  assert.ok(
    !visibleToOther.some((c) => c.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar o condomínio",
  );
});
