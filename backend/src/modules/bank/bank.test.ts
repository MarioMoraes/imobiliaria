import assert from "node:assert/strict";
import { test } from "node:test";
import * as entriesRepo from "../cashflow/entries.repository.js";
import { findBankById, insertBank, listBanks, updateBank } from "./bank.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 * Um banco de um tenant nunca pode ser visto por outro.
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("bank")).id;
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";

test("um banco criado num tenant não é visível por outro tenant", async () => {
  const created = await insertBank(TENANT, {
    name: `Banco Isolamento ${Date.now()}`,
    favorite: false,
  });

  const visibleToDemo = await listBanks(TENANT);
  assert.ok(
    visibleToDemo.some((b) => b.id === created.id),
    "o tenant dono deve enxergar o próprio banco",
  );

  const visibleToOther = await listBanks(OTHER_TENANT);
  assert.ok(
    !visibleToOther.some((b) => b.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar o banco",
  );
});

/**
 * O saldo é DERIVADO dos lançamentos manuais da conta, e não da coluna
 * `banks.balance_cents`.
 *
 * A coluna nasceu marcada como "derivada" mas nunca teve quem a alimentasse:
 * toda conta mostrava R$ 0,00 na tela como se fosse saldo real. Este teste trava
 * a derivação — se alguém voltar a ler a coluna, ele quebra no primeiro assert.
 */
test("o saldo da conta é derivado dos lançamentos, não da coluna", async () => {
  const banco = await insertBank(TENANT, { name: `Conta Saldo ${Date.now()}`, favorite: false });
  const outro = await insertBank(TENANT, { name: `Conta Vizinha ${Date.now()}`, favorite: false });

  assert.equal(banco.balanceCents, 0, "conta sem lançamento começa zerada");

  await entriesRepo.insertEntry(TENANT, {
    entryDate: "2026-05-10",
    direction: "ENTRADA",
    bankId: banco.id,
    amountCents: 250_000,
    description: "Aporte",
  });
  await entriesRepo.insertEntry(TENANT, {
    entryDate: "2026-05-12",
    direction: "SAIDA",
    bankId: banco.id,
    amountCents: 90_000,
    description: "Aluguel do escritório",
  });
  // Lançamento de OUTRA conta: o saldo é por banco, não do tenant inteiro.
  await entriesRepo.insertEntry(TENANT, {
    entryDate: "2026-05-13",
    direction: "ENTRADA",
    bankId: outro.id,
    amountCents: 700_000,
    description: "Não é desta conta",
  });

  const recarregado = await findBankById(TENANT, banco.id);
  assert.equal(recarregado?.balanceCents, 160_000, "entradas − saídas da própria conta");

  // Regressão do `sum() FILTER`: sem um COALESCE por lado, uma conta que só
  // recebeu entradas daria `250.000 − NULL` = NULL e apareceria zerada.
  assert.equal(
    (await findBankById(TENANT, outro.id))?.balanceCents,
    700_000,
    "conta só com entradas não pode voltar zerada",
  );

  // A escrita recarrega pelo mesmo SELECT: editar o nome não pode zerar o saldo.
  const renomeado = await updateBank(TENANT, banco.id, { name: "Conta Renomeada" });
  assert.equal(renomeado?.name, "Conta Renomeada");
  assert.equal(renomeado?.balanceCents, 160_000);
});
