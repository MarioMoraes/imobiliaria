import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCommissionSplit } from "./commission-split.js";

/**
 * Cálculo puro da divisão da comissão de venda — sem banco, sem tenant (mesmo
 * papel de `payable/owner-payout.test.ts`).
 *
 * O que estes casos protegem: a imobiliária lança a comissão CHEIA que recebe do
 * cliente e a parte do corretor é uma saída à parte. Trocar isso pelo líquido
 * some com a despesa e faz a margem da venda parecer o valor cheio.
 */

const VENDA = 500_000_00; // R$ 500.000,00

test("sem corretor, a comissão inteira é da imobiliária", () => {
  const entries = buildCommissionSplit({
    saleValueCents: VENDA,
    commissionPercent: 6,
    broker: null,
    dueDate: "2026-08-10",
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.party, "IMOBILIARIA");
  assert.equal(entries[0]!.amountCents, 30_000_00);
  assert.equal(entries[0]!.brokerId, null);
});

test("com corretor, nascem duas partes e a receita continua cheia", () => {
  const entries = buildCommissionSplit({
    saleValueCents: VENDA,
    commissionPercent: 6,
    broker: { id: "b1", commissionPercent: 2 },
    dueDate: "2026-08-10",
  });

  assert.equal(entries.length, 2);

  const imobiliaria = entries.find((e) => e.party === "IMOBILIARIA")!;
  const corretor = entries.find((e) => e.party === "CORRETOR")!;

  // A entrada é o que o cliente paga, não o que sobra: R$ 30.000, não R$ 20.000.
  assert.equal(imobiliaria.amountCents, 30_000_00);
  assert.equal(corretor.amountCents, 10_000_00);
  assert.equal(corretor.brokerId, "b1");

  // A margem é a diferença — o número que a tela chama de "resultado".
  assert.equal(imobiliaria.amountCents - corretor.amountCents, 20_000_00);
});

test("o acerto do corretor pode vencer depois do recebimento do cliente", () => {
  const entries = buildCommissionSplit({
    saleValueCents: VENDA,
    commissionPercent: 6,
    broker: { id: "b1", commissionPercent: 2 },
    dueDate: "2026-08-10",
    brokerDueDate: "2026-09-05",
  });

  assert.equal(entries.find((e) => e.party === "IMOBILIARIA")!.dueDate, "2026-08-10");
  assert.equal(entries.find((e) => e.party === "CORRETOR")!.dueDate, "2026-09-05");
});

test("corretor com percentual maior que a comissão não faz a receita ficar negativa", () => {
  // Dado sujo: 8% para o corretor sobre uma comissão de 6% cobrada do cliente.
  const entries = buildCommissionSplit({
    saleValueCents: VENDA,
    commissionPercent: 6,
    broker: { id: "b1", commissionPercent: 8 },
    dueDate: "2026-08-10",
  });

  const imobiliaria = entries.find((e) => e.party === "IMOBILIARIA")!;
  const corretor = entries.find((e) => e.party === "CORRETOR")!;

  assert.equal(corretor.amountCents, imobiliaria.amountCents, "trunca no total da comissão");
  assert.ok(imobiliaria.amountCents - corretor.amountCents >= 0);
});

test("venda ou percentual zerado não gera lançamento nenhum", () => {
  assert.deepEqual(
    buildCommissionSplit({
      saleValueCents: 0,
      commissionPercent: 6,
      broker: null,
      dueDate: "2026-08-10",
    }),
    [],
  );
  assert.deepEqual(
    buildCommissionSplit({
      saleValueCents: VENDA,
      commissionPercent: 0,
      broker: null,
      dueDate: "2026-08-10",
    }),
    [],
  );
});

test("percentual quebrado arredonda ao centavo, sem fração", () => {
  const entries = buildCommissionSplit({
    saleValueCents: 333_333_33,
    commissionPercent: 5.5,
    broker: { id: "b1", commissionPercent: 1.75 },
    dueDate: "2026-08-10",
  });

  for (const entry of entries) {
    assert.equal(entry.amountCents, Math.round(entry.amountCents), "valor em centavos inteiros");
  }
  assert.equal(entries.find((e) => e.party === "IMOBILIARIA")!.amountCents, 18_333_33);
  assert.equal(entries.find((e) => e.party === "CORRETOR")!.amountCents, 5_833_33);
});

test("a descrição identifica o imóvel quando ele é informado", () => {
  const entries = buildCommissionSplit({
    saleValueCents: VENDA,
    commissionPercent: 6,
    broker: { id: "b1", commissionPercent: 2 },
    dueDate: "2026-08-10",
    reference: "Imóvel 42",
  });

  assert.equal(entries[0]!.description, "Comissão de venda — Imóvel 42");
  assert.equal(entries[1]!.description, "Comissão de corretor — Imóvel 42");
});
