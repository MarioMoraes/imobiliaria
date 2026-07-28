import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOwnerPayouts, type OwnerPayoutSource } from "./owner-payout.js";

/**
 * Regra do repasse ao proprietário — testada sozinha, sem banco.
 *
 * O que estes testes protegem é dinheiro de terceiros: se o rateio perder um
 * centavo, o total repassado deixa de bater com o aluguel recebido e a diferença
 * some silenciosamente do caixa da imobiliária.
 */

const BASE: OwnerPayoutSource = {
  receivableId: "11111111-1111-1111-1111-111111111111",
  contractId: "22222222-2222-2222-2222-222222222222",
  propertyId: "33333333-3333-3333-3333-333333333333",
  competence: "2026-07",
  baseCents: 300_000, // R$ 3.000,00
  paidAt: "2026-07-05",
  adminFeePercent: 10,
  ownerPayDay: 10,
  owners: [{ personId: "44444444-4444-4444-4444-444444444444", sharePercent: 100 }],
};

test("dono único recebe o aluguel menos a taxa de administração", () => {
  const [payout] = buildOwnerPayouts(BASE);

  assert.ok(payout);
  assert.equal(payout.grossCents, 300_000);
  assert.equal(payout.adminFeeCents, 30_000);
  assert.equal(payout.amountCents, 270_000);
  assert.equal(payout.adminFeePercent, 10);
  assert.equal(payout.competence, "2026-07");
});

test("vence no mês seguinte ao pagamento, no Dia Prop do contrato", () => {
  const [payout] = buildOwnerPayouts(BASE);
  assert.equal(payout?.dueDate, "2026-08-10");
});

test("aluguel pago com atraso é repassado no mês seguinte ao pagamento, não à competência", () => {
  // Competência de julho, quitada só em 12/08: o prazo conta do dinheiro entrar.
  const [payout] = buildOwnerPayouts({ ...BASE, paidAt: "2026-08-12" });
  assert.equal(payout?.dueDate, "2026-09-10");
});

test("Dia Prop maior que o mês fecha no último dia", () => {
  // Pago em março, Dia Prop 31 → abril tem 30.
  const [payout] = buildOwnerPayouts({
    ...BASE,
    paidAt: "2026-03-05",
    ownerPayDay: 31,
  });
  assert.equal(payout?.dueDate, "2026-04-30");
});

test("pagamento em dezembro vira para janeiro do ano seguinte", () => {
  const [payout] = buildOwnerPayouts({ ...BASE, paidAt: "2026-12-20" });
  assert.equal(payout?.dueDate, "2027-01-10");
});

test("sem Dia Prop, cai no dia do próprio pagamento", () => {
  const [payout] = buildOwnerPayouts({
    ...BASE,
    ownerPayDay: null,
    paidAt: "2026-07-22",
  });
  assert.equal(payout?.dueDate, "2026-08-22");
});

test("rateio entre coproprietários fecha no centavo", () => {
  // 60/40 sobre um valor que não divide redondo: 1.000,01 e taxa de 10%.
  const payouts = buildOwnerPayouts({
    ...BASE,
    baseCents: 100_001,
    owners: [
      { personId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", sharePercent: 60 },
      { personId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", sharePercent: 40 },
    ],
  });

  assert.equal(payouts.length, 2);

  const feeTotal = Math.round(100_001 * 0.1); // 10.000
  const sum = (pick: (p: (typeof payouts)[number]) => number): number =>
    payouts.reduce((total, p) => total + pick(p), 0);

  assert.equal(sum((p) => p.grossCents), 100_001, "o bruto rateado tem que somar o aluguel");
  assert.equal(sum((p) => p.adminFeeCents), feeTotal, "a taxa rateada tem que somar a receita");
  assert.equal(
    sum((p) => p.amountCents),
    100_001 - feeTotal,
    "o líquido rateado tem que somar aluguel menos taxa",
  );

  // Os N-1 primeiros truncam; o último absorve o resto.
  assert.equal(payouts[0]?.grossCents, 60_000);
  assert.equal(payouts[1]?.grossCents, 40_001);
});

test("cada dono carrega a própria participação e o líquido é bruto menos taxa", () => {
  const payouts = buildOwnerPayouts({
    ...BASE,
    owners: [
      { personId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", sharePercent: 60 },
      { personId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", sharePercent: 40 },
    ],
  });

  assert.equal(payouts[0]?.sharePercent, 60);
  assert.equal(payouts[0]?.amountCents, 162_000); // 180.000 - 18.000
  assert.equal(payouts[1]?.sharePercent, 40);
  assert.equal(payouts[1]?.amountCents, 108_000); // 120.000 - 12.000
});

test("sem taxa de administração o dono recebe o aluguel integral", () => {
  const [payout] = buildOwnerPayouts({ ...BASE, adminFeePercent: 0 });
  assert.equal(payout?.adminFeeCents, 0);
  assert.equal(payout?.amountCents, 300_000);
});

test("a base é o valor da parcela — juros e multa não entram no repasse", () => {
  // Quem chama passa `amountCents` (parcela), nunca `paidAmountCents`. Aqui o
  // contrato da função é o que garante isso: só existe uma base.
  const [payout] = buildOwnerPayouts({ ...BASE, baseCents: 300_000 });
  assert.equal(payout?.grossCents, 300_000);
});

test("falta de dado devolve lista vazia em vez de erro", () => {
  assert.deepEqual(buildOwnerPayouts({ ...BASE, owners: [] }), []);
  assert.deepEqual(buildOwnerPayouts({ ...BASE, paidAt: null }), []);
  assert.deepEqual(buildOwnerPayouts({ ...BASE, baseCents: 0 }), []);
});
