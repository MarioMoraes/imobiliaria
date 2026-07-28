import assert from "node:assert/strict";
import { test } from "node:test";
import { listProperties } from "../property/property.repository.js";
import { findByProperty, getOrCreateByProperty } from "./inspection.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * Garante que a vistoria de um imóvel nunca vaza para outro tenant. Depende do
 * banco containerizado (`npm run infra:up`) e do seed em init.sql.
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

test("a vistoria criada no tenant demo não é visível por outro tenant", async () => {
  const properties = await listProperties(DEMO_TENANT);
  const property = properties[0];
  assert.ok(property, "o seed do tenant demo precisa ter ao menos um imóvel");

  const { inspection } = await getOrCreateByProperty(DEMO_TENANT, property.id);

  const visibleToDemo = await findByProperty(DEMO_TENANT, property.id);
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
  const properties = await listProperties(DEMO_TENANT);
  const property = properties[0];
  assert.ok(property, "o seed do tenant demo precisa ter ao menos um imóvel");

  const first = await getOrCreateByProperty(DEMO_TENANT, property.id);
  const second = await getOrCreateByProperty(DEMO_TENANT, property.id);

  assert.equal(second.inspection.id, first.inspection.id);
  // A sincronia com o catálogo é idempotente: reabrir não duplica linhas.
  assert.equal(second.entries.length, first.entries.length);
});
