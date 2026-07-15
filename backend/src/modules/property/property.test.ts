import assert from "node:assert/strict";
import { test } from "node:test";
import { listProperties, insertProperty } from "./property.repository.js";
import { createPropertySchema } from "./property.schema.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 *
 * Garante que dados de um tenant nunca vazam para outro. Depende do banco
 * containerizado de pex.: `npm run infra:up` e do seed em init.sql (tenant demo).
 *
 * Rode com: npm test   (node --test)
 * O tenant demo tem id 00000000-0000-0000-0000-000000000001.
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

test("um imóvel criado no tenant demo não é visível por outro tenant", async () => {
  const created = await insertProperty(
    DEMO_TENANT,
    createPropertySchema.parse({
      title: "Imóvel de teste de isolamento",
      kind: "sale",
      purpose: "sale",
      status: "available",
    }),
  );

  const visibleToDemo = await listProperties(DEMO_TENANT);
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
