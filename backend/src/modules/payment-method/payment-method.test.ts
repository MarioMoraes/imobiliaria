import assert from "node:assert/strict";
import { test } from "node:test";
import {
  insertPaymentMethod,
  listPaymentMethods,
} from "./payment-method.repository.js";
import { createTestTenant } from "../../testing/tenants.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * Cada arquivo cria o próprio tenant; o fixture o descarta em cascata no `after`.
 */
const TENANT = (await createTestTenant("payment-method")).id;
const OTHER_TENANT = (await createTestTenant("payment-method-other")).id;

test("uma forma de pagamento de um tenant não é visível por outro", async () => {
  const created = await insertPaymentMethod(TENANT, { name: "À vista" });

  const doDono = await listPaymentMethods(TENANT);
  assert.ok(
    doDono.some((m) => m.id === created.id),
    "o tenant dono deve enxergar a própria forma de pagamento",
  );

  const doOutro = await listPaymentMethods(OTHER_TENANT);
  assert.ok(
    !doOutro.some((m) => m.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar a forma de pagamento",
  );
});

test("o código é sequencial DENTRO do tenant, e recomeça em outro", async () => {
  const tenant = (await createTestTenant("payment-method-seq")).id;
  const primeira = await insertPaymentMethod(tenant, { name: "À vista" });
  const segunda = await insertPaymentMethod(tenant, { name: "Financiado" });

  assert.equal(primeira.code, 1);
  assert.equal(segunda.code, 2, "o segundo código é o MAX do tenant + 1");

  const vizinho = (await createTestTenant("payment-method-seq-2")).id;
  const daVizinha = await insertPaymentMethod(vizinho, { name: "À vista" });
  assert.equal(
    daVizinha.code,
    1,
    "a sequência é por tenant: o vizinho começa do 1 de novo",
  );
});
