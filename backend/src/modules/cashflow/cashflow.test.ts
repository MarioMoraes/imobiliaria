import assert from "node:assert/strict";
import { test } from "node:test";
import { insertCommission } from "../commission/commission.repository.js";
import * as service from "./cashflow.service.js";
import {
  deleteCategory,
  insertCategory,
  insertEntry,
  listCategories,
  listEntries,
} from "./entries.repository.js";
import { listCashFlowEntriesQuerySchema } from "./cashflow.schema.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI —
 * das duas tabelas próprias do fluxo de caixa, mais o comportamento do extrato
 * consolidado.
 *
 * Depende da infra de pé: `npm run infra:up`.
 */
import { createTestTenant } from "../../testing/tenants.js";

// Dois tenants DE VERDADE: o "outro" precisa existir para provar que a RLS o
// separa, e não só que uma consulta sem dado volta vazia.
const TENANT = (await createTestTenant("cashflow")).id;
const OTHER_TENANT = (await createTestTenant("cashflow-outro")).id;

const MONTH = "2026-07";
const ALL_ENTRIES = listCashFlowEntriesQuerySchema.parse({});

test("um lançamento manual de um tenant não é visível por outro", async () => {
  const created = await insertEntry(TENANT, {
    entryDate: `${MONTH}-15`,
    direction: "SAIDA",
    amountCents: 250_000,
    description: "Aluguel do escritório",
  });

  const doDono = await listEntries(TENANT, ALL_ENTRIES);
  assert.ok(
    doDono.some((e) => e.id === created.id),
    "o tenant dono deve enxergar o próprio lançamento",
  );

  const doOutro = await listEntries(OTHER_TENANT, ALL_ENTRIES);
  assert.ok(
    !doOutro.some((e) => e.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar o lançamento",
  );
});

test("uma categoria de um tenant não é visível por outro", async () => {
  const created = await insertCategory(TENANT, {
    name: "Tarifas bancárias",
    direction: "SAIDA",
  });

  assert.ok((await listCategories(TENANT)).some((c) => c.id === created.id));
  assert.ok(
    !(await listCategories(OTHER_TENANT)).some((c) => c.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar a categoria",
  );
});

test("o extrato de um tenant não mistura movimento de outro", async () => {
  await insertEntry(OTHER_TENANT, {
    entryDate: `${MONTH}-10`,
    direction: "SAIDA",
    amountCents: 999_999,
    description: "Despesa do outro tenant",
  });

  const extrato = await service.statement(TENANT, MONTH);
  assert.ok(
    !extrato.movements.some((m) => m.description === "Despesa do outro tenant"),
    "TENANT LEAKAGE: o extrato não pode ver movimento de outro tenant",
  );
});

test("o código da categoria é sequencial dentro do tenant", async () => {
  const primeira = await insertCategory(TENANT, { name: "Seq A", direction: "SAIDA" });
  const segunda = await insertCategory(TENANT, { name: "Seq B", direction: "SAIDA" });
  assert.equal(segunda.code, primeira.code + 1);

  // O contador é POR TENANT: o outro começa do próprio 1, não continua o daqui.
  const noOutro = await insertCategory(OTHER_TENANT, { name: "Seq A", direction: "SAIDA" });
  assert.equal(noOutro.code, 1);
});

test("apagar a categoria solta os lançamentos em vez de apagá-los", async () => {
  const categoria = await insertCategory(TENANT, {
    name: "Categoria efêmera",
    direction: "SAIDA",
  });
  const lancamento = await insertEntry(TENANT, {
    entryDate: `${MONTH}-20`,
    direction: "SAIDA",
    categoryId: categoria.id,
    amountCents: 50_000,
    description: "Despesa categorizada",
  });

  assert.equal(await deleteCategory(TENANT, categoria.id), true);

  const sobreviventes = await listEntries(TENANT, ALL_ENTRIES);
  const ainda = sobreviventes.find((e) => e.id === lancamento.id);
  assert.ok(ainda, "o lançamento é o fato — não pode sumir junto com o rótulo");
  assert.equal(ainda.categoryId, null);
});

test("lançamento manual entra no caixa E no resultado, com o sinal da direção", async () => {
  // Mês exclusivo deste caso: o tenant é o mesmo do arquivo inteiro, e somar
  // sobre um mês que outro teste também usa mediria o lixo dos vizinhos.
  const mes = "2026-06";
  const receita = await insertEntry(TENANT, {
    entryDate: `${mes}-05`,
    direction: "ENTRADA",
    amountCents: 100_000,
    description: "Receita avulsa do teste",
  });
  const despesa = await insertEntry(TENANT, {
    entryDate: `${mes}-06`,
    direction: "SAIDA",
    amountCents: 40_000,
    description: "Despesa avulsa do teste",
  });

  const { movements, summary } = await service.statement(TENANT, mes);

  const entrada = movements.find((m) => m.sourceId === receita.id)!;
  const saida = movements.find((m) => m.sourceId === despesa.id)!;

  assert.ok(entrada.affectsCash && entrada.affectsResult);
  assert.ok(saida.affectsCash && saida.affectsResult);
  assert.equal(summary.manualIncomeCents, 100_000);
  assert.equal(summary.manualExpenseCents, 40_000);
});

test("a comissão só entra no extrato depois de quitada, na data do caixa", async () => {
  const comissao = await insertCommission(TENANT, {
    kind: "VENDA",
    party: "IMOBILIARIA",
    baseCents: 500_000_00,
    percent: 6,
    amountCents: 30_000_00,
    dueDate: `${MONTH}-10`,
  });

  const emAberto = await service.statement(TENANT, MONTH);
  assert.ok(
    !emAberto.movements.some((m) => m.sourceId === comissao.id),
    "comissão em aberto não é caixa: o dinheiro ainda não se moveu",
  );

  // Quitada num mês diferente do vencimento — o extrato segue a data do caixa.
  const { updateCommission } = await import("../commission/commission.repository.js");
  await updateCommission(TENANT, comissao.id, {
    status: "QUITADO",
    settledAt: "2026-08-03",
    settledAmountCents: 30_000_00,
  });

  const noVencimento = await service.statement(TENANT, MONTH);
  assert.ok(
    !noVencimento.movements.some((m) => m.sourceId === comissao.id),
    "o mês do vencimento não é o do caixa",
  );

  const naQuitacao = await service.statement(TENANT, "2026-08");
  const movimento = naQuitacao.movements.find((m) => m.sourceId === comissao.id)!;
  assert.equal(movimento.label, "Comissão de Venda");
  assert.equal(movimento.direction, "ENTRADA");
  assert.equal(naQuitacao.summary.commissionEarnedCents, 30_000_00);
});

test("a comissão do corretor é saída, e a margem da venda é a diferença", async () => {
  const mes = "2026-09";
  const { updateCommission } = await import("../commission/commission.repository.js");

  const daImobiliaria = await insertCommission(TENANT, {
    kind: "VENDA",
    party: "IMOBILIARIA",
    baseCents: 500_000_00,
    percent: 6,
    amountCents: 30_000_00,
    dueDate: `${mes}-10`,
  });
  const doCorretor = await insertCommission(TENANT, {
    kind: "VENDA",
    party: "CORRETOR",
    baseCents: 500_000_00,
    percent: 2,
    amountCents: 10_000_00,
    dueDate: `${mes}-10`,
  });

  for (const id of [daImobiliaria.id, doCorretor.id]) {
    await updateCommission(TENANT, id, { status: "QUITADO", settledAt: `${mes}-15` });
  }

  const { summary } = await service.statement(TENANT, mes);
  assert.equal(summary.commissionEarnedCents, 30_000_00);
  assert.equal(summary.commissionPaidCents, 10_000_00);
  assert.equal(summary.result.netCents, 20_000_00, "a margem é receita menos despesa");
  assert.equal(summary.cash.netCents, 20_000_00, "comissão é dinheiro próprio: caixa = resultado");
});

test("a janela do mês é meio-aberta: o dia 1 do mês seguinte fica de fora", async () => {
  await insertEntry(TENANT, {
    entryDate: "2026-10-31",
    direction: "SAIDA",
    amountCents: 11_111,
    description: "Último dia de outubro",
  });
  await insertEntry(TENANT, {
    entryDate: "2026-11-01",
    direction: "SAIDA",
    amountCents: 22_222,
    description: "Primeiro dia de novembro",
  });

  const outubro = await service.statement(TENANT, "2026-10");
  assert.equal(outubro.summary.manualExpenseCents, 11_111);

  const novembro = await service.statement(TENANT, "2026-11");
  assert.equal(novembro.summary.manualExpenseCents, 22_222);
});
