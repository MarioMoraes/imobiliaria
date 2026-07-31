import assert from "node:assert/strict";
import { test } from "node:test";
import { insertProperty } from "../property/property.repository.js";
import { createPropertySchema } from "../property/property.schema.js";
import { findByProperty, getOrCreateByProperty } from "./inspection.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * Garante que a vistoria de um imóvel nunca vaza para outro tenant. Depende do
 * banco containerizado (`npm run infra:up`).
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("inspection")).id;
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

/** Imóvel próprio: o teste não depende mais do que houver no seed. */
async function freshProperty() {
  return insertProperty(
    TENANT,
    createPropertySchema.parse({
      title: "Imóvel da vistoria",
      kind: "rent",
      purpose: "rent",
      status: "available",
    }),
  );
}

test("a vistoria criada num tenant não é visível por outro tenant", async () => {
  const property = await freshProperty();

  const { inspection } = await getOrCreateByProperty(TENANT, property.id);

  const visibleToDemo = await findByProperty(TENANT, property.id);
  assert.equal(
    visibleToDemo?.id,
    inspection.id,
    "o tenant dono deve enxergar a própria vistoria",
  );

  const visibleToOther = await findByProperty(OTHER_TENANT, property.id);
  assert.equal(
    visibleToOther,
    null,
    "TENANT LEAKAGE: outro tenant não pode enxergar a vistoria",
  );
});

test("reabrir a vistoria do mesmo imóvel devolve a mesma (uma por imóvel)", async () => {
  const property = await freshProperty();

  const first = await getOrCreateByProperty(TENANT, property.id);
  const second = await getOrCreateByProperty(TENANT, property.id);

  assert.equal(second.inspection.id, first.inspection.id);
  // A sincronia com o catálogo é idempotente: reabrir não duplica linhas.
  assert.equal(second.entries.length, first.entries.length);
});
