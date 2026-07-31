import assert from "node:assert/strict";
import { test } from "node:test";
import { withTenant } from "../../shared/db.js";
import { financeStats, propertyStats } from "./dashboard.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * O painel é agregação: aqui o vazamento não apareceria como uma linha alheia
 * na tela, e sim como um número somado errado. Por isso o teste compara os
 * totais antes/depois de inserir dado só neste tenant.
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("dashboard")).id;
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";

test("imóvel de um tenant não entra na contagem de outro", async () => {
  const before = await propertyStats(OTHER_TENANT);

  const propertyId = await withTenant(TENANT, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO properties (tenant_id, title, kind, purpose, status, price_cents)
       VALUES ($1, $2, 'rent', 'rent', 'available', 100000) RETURNING id`,
      [TENANT, `Imóvel Isolamento ${Date.now()}`],
    );
    return rows[0]!.id;
  });

  const demo = await propertyStats(TENANT);
  assert.ok(demo.available >= 1, "o tenant dono deve contar o próprio imóvel");

  const after = await propertyStats(OTHER_TENANT);

  // O painel é agregação: um resíduo de teste apareceria como número errado na
  // tela de quem desenvolve. Por isso este teste limpa o que criou.
  await withTenant(TENANT, (client) =>
    client.query("DELETE FROM properties WHERE id = $1", [propertyId]),
  );

  assert.equal(
    after.total,
    before.total,
    "TENANT LEAKAGE: o imóvel de um tenant entrou na contagem de outro tenant",
  );
});

test("recebível de um tenant não entra no financeiro de outro", async () => {
  const before = await financeStats(OTHER_TENANT);

  const receivableId = await withTenant(TENANT, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO receivables (tenant_id, kind, description, amount_cents, due_date, status, paid_at, paid_amount_cents)
       VALUES ($1, 'ALUGUEL', 'Isolamento', 500000, CURRENT_DATE, 'PAGO', CURRENT_DATE, 500000)
       RETURNING id`,
      [TENANT],
    );
    return rows[0]!.id;
  });

  const demo = await financeStats(TENANT);
  assert.ok(
    demo.receivedThisMonthCents >= 500000,
    "o tenant dono deve somar o próprio recebimento",
  );

  const after = await financeStats(OTHER_TENANT);

  await withTenant(TENANT, (client) =>
    client.query("DELETE FROM receivables WHERE id = $1", [receivableId]),
  );

  assert.equal(
    after.receivedThisMonthCents,
    before.receivedThisMonthCents,
    "TENANT LEAKAGE: o recebimento de um tenant entrou no financeiro de outro tenant",
  );
});
