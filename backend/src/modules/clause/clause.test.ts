import assert from "node:assert/strict";
import { test } from "node:test";
import { insertClause, listClauses, deleteClause } from "./clause.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * Depende da infra de pé (`npm run infra:up`) e do seed em init.sql.
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

test("uma cláusula criada no tenant demo não é visível por outro tenant", async () => {
  const created = await insertClause(DEMO_TENANT, {
    name: `Cláusula de isolamento ${Date.now()}`,
    description: "Cláusula usada apenas no teste de isolamento multi-tenant.",
  });

  try {
    const visibleToDemo = await listClauses(DEMO_TENANT);
    assert.ok(
      visibleToDemo.some((c) => c.id === created.id),
      "o tenant dono deve enxergar a própria cláusula",
    );

    const visibleToOther = await listClauses(OTHER_TENANT);
    assert.ok(
      !visibleToOther.some((c) => c.id === created.id),
      "TENANT LEAKAGE: outro tenant não pode enxergar a cláusula",
    );
  } finally {
    await deleteClause(DEMO_TENANT, created.id);
  }
});
