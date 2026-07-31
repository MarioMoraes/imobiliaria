import assert from "node:assert/strict";
import { test } from "node:test";
import { listProperties, insertProperty } from "./property.repository.js";
import { createPropertySchema } from "./property.schema.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 *
 * Garante que dados de um tenant nunca vazam para outro. Depende do banco
 * containerizado (`npm run infra:up`).
 *
 * Rode com: npm test   (node --test)
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("property")).id;
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

test("um imóvel criado num tenant não é visível por outro tenant", async () => {
  const created = await insertProperty(
    TENANT,
    createPropertySchema.parse({
      title: "Imóvel de teste de isolamento",
      kind: "sale",
      purpose: "sale",
      status: "available",
    }),
  );

  const visibleToDemo = await listProperties(TENANT);
  assert.ok(
    visibleToDemo.some((p) => p.id === created.id),
    "o tenant dono deve enxergar o próprio imóvel",
  );

  const visibleToOther = await listProperties(OTHER_TENANT);
  assert.ok(
    !visibleToOther.some((p) => p.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar o imóvel",
  );
});
