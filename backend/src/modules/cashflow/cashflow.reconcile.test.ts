import assert from "node:assert/strict";
import { test } from "node:test";
import * as receivableRepo from "../receivable/receivable.repository.js";
import * as payableRepo from "../payable/payable.repository.js";
import { buildOwnerPayouts } from "../payable/owner-payout.js";
import { listPayablesQuerySchema, type Payable } from "../payable/payable.schema.js";
import * as service from "./cashflow.service.js";

/**
 * O invariante que justifica o desenho de duas colunas (`affectsCash` /
 * `affectsResult`).
 *
 * A taxa de administração JÁ ESTÁ DENTRO do aluguel recebido — ela é a diferença
 * entre o que o inquilino pagou e o que o proprietário recebe. Lançá-la como uma
 * terceira entrada de caixa somaria o mesmo dinheiro duas vezes, e o extrato do
 * banco nunca fecharia. Estes casos travam isso:
 *
 *   caixa retido (recebido − repassado) == taxa de administração + juros e multa
 *
 * Se alguém "consertar" o read model somando a taxa no caixa, este arquivo quebra.
 *
 * Depende da infra de pé: `npm run infra:up`.
 */
import { createTestTenant } from "../../testing/tenants.js";

const TENANT = (await createTestTenant("cashflow-reconcile")).id;

const ALUGUEL = 300_000; // R$ 3.000,00
const TAXA_PERCENT = 10;
const OWNER = "11111111-1111-1111-1111-111111111111";
const TODOS_OS_REPASSES = listPayablesQuerySchema.parse({});

/** O repasse gerado por uma parcela — há exatamente um por cenário deste arquivo. */
async function repasseDe(receivableId: string): Promise<Payable> {
  const todos = await payableRepo.listPayables(TENANT, TODOS_OS_REPASSES);
  const repasse = todos.find((p) => p.receivableId === receivableId);
  assert.ok(repasse, "o cenário precisa ter gerado o repasse");
  return repasse;
}

/**
 * Monta o ciclo completo de um aluguel: parcela criada, baixada, repasse gerado
 * pelo cálculo real (`buildOwnerPayouts`) e — opcionalmente — pago.
 *
 * Monta o cenário aqui em vez de procurar dado do seed: um `SELECT ... LIMIT 1`
 * se auto-pula num tenant vazio e a cobertura some em silêncio.
 */
async function cicloDeAluguel(opts: {
  competence: string;
  paidAt: string;
  /** O que o inquilino efetivamente pagou (maior que a parcela = juros e multa). */
  paidAmountCents?: number;
  /** Data da baixa do repasse; ausente, o repasse fica em aberto. */
  payoutPaidAt?: string;
}): Promise<{ receivableId: string; adminFeeCents: number; payoutCents: number }> {
  const parcela = await receivableRepo.insertReceivable(TENANT, {
    kind: "ALUGUEL",
    description: `Aluguel ${opts.competence}`,
    competence: opts.competence,
    amountCents: ALUGUEL,
    dueDate: `${opts.competence}-05`,
  });

  await receivableRepo.updateReceivable(TENANT, parcela.id, {
    status: "PAGO",
    paidAt: opts.paidAt,
    paidAmountCents: opts.paidAmountCents ?? ALUGUEL,
  });

  // O MESMO cálculo que a baixa dispara em produção — não uma cópia com números
  // escolhidos a dedo, senão o teste passaria mesmo se a regra mudasse.
  const payouts = buildOwnerPayouts({
    receivableId: parcela.id,
    contractId: null,
    propertyId: null,
    competence: opts.competence,
    baseCents: ALUGUEL,
    paidAt: opts.paidAt,
    adminFeePercent: TAXA_PERCENT,
    ownerPayDay: 10,
    owners: [{ personId: OWNER, sharePercent: 100 }],
  });
  assert.equal(payouts.length, 1, "o cenário precisa de exatamente um repasse");

  await payableRepo.insertOwnerPayouts(
    TENANT,
    { receivableId: parcela.id, contractId: null, propertyId: null },
    payouts,
  );

  if (opts.payoutPaidAt) {
    const repasse = await repasseDe(parcela.id);
    await payableRepo.updatePayable(TENANT, repasse.id, {
      status: "PAGO",
      paidAt: opts.payoutPaidAt,
      paidAmountCents: repasse.amountCents,
    });
  }

  return {
    receivableId: parcela.id,
    adminFeeCents: payouts[0]!.adminFeeCents,
    payoutCents: payouts[0]!.amountCents,
  };
}

test("aluguel recebido e repassado no mesmo mês: o retido é exatamente a taxa", async () => {
  const mes = "2026-03";
  const { adminFeeCents, payoutCents } = await cicloDeAluguel({
    competence: mes,
    paidAt: `${mes}-05`,
    payoutPaidAt: `${mes}-20`,
  });

  const { summary } = await service.statement(TENANT, mes);

  assert.equal(summary.cash.inflowCents, ALUGUEL, "entrou o aluguel INTEIRO no banco");
  assert.equal(summary.cash.outflowCents, payoutCents, "saiu o repasse líquido");

  // O ponto do arquivo: o caixa retido é a taxa, e não taxa × 2.
  assert.equal(summary.cash.netCents, adminFeeCents);
  assert.equal(summary.result.netCents, adminFeeCents);
  assert.equal(summary.adminFeeCents, adminFeeCents);
});

test("a taxa de administração não aparece como entrada de caixa", async () => {
  const mes = "2026-04";
  const { adminFeeCents } = await cicloDeAluguel({
    competence: mes,
    paidAt: `${mes}-05`,
    payoutPaidAt: `${mes}-20`,
  });

  const { movements, summary } = await service.statement(TENANT, mes);
  const taxa = movements.find((m) => m.source === "TAXA_ADM")!;

  assert.equal(taxa.amountCents, adminFeeCents);
  assert.equal(taxa.affectsCash, false, "somar a taxa no caixa contaria o mesmo dinheiro 2x");
  assert.equal(taxa.affectsResult, true, "mas ela É a receita da imobiliária");

  // A soma INGÊNUA de todas as entradas é o erro que este desenho evita: ela dá
  // aluguel + taxa, e o banco só viu o aluguel.
  const somaIngenua = movements
    .filter((m) => m.direction === "ENTRADA")
    .reduce((total, m) => total + m.amountCents, 0);
  assert.equal(somaIngenua, ALUGUEL + adminFeeCents);
  assert.equal(summary.cash.inflowCents, ALUGUEL);
});

test("juros e multa ficam com a imobiliária e fecham a conta do retido", async () => {
  const mes = "2026-05";
  const jurosEMulta = 15_000; // R$ 150,00 de atraso
  const { adminFeeCents, payoutCents } = await cicloDeAluguel({
    competence: mes,
    paidAt: `${mes}-12`,
    paidAmountCents: ALUGUEL + jurosEMulta,
    payoutPaidAt: `${mes}-25`,
  });

  const { summary } = await service.statement(TENANT, mes);

  // O repasse é calculado sobre a PARCELA, não sobre o pago: o dono não lucra
  // com o próprio inadimplente (ver payable/owner-payout.ts).
  assert.equal(summary.cash.inflowCents, ALUGUEL + jurosEMulta);
  assert.equal(summary.cash.outflowCents, payoutCents);
  assert.equal(summary.lateFeeCents, jurosEMulta);

  // A identidade completa: retido == taxa + juros. Sem a linha de juros e multa
  // o resultado ficaria menor que o caixa e ninguém saberia explicar a sobra.
  assert.equal(summary.cash.netCents, adminFeeCents + jurosEMulta);
  assert.equal(summary.result.netCents, adminFeeCents + jurosEMulta);
});

test("recebido num mês e repassado no seguinte: o caixa infla e o retido explica", async () => {
  const recebimento = "2026-01";
  const { adminFeeCents, payoutCents } = await cicloDeAluguel({
    competence: recebimento,
    paidAt: `${recebimento}-05`,
    payoutPaidAt: "2026-02-10",
  });

  const janeiro = await service.statement(TENANT, recebimento);
  // Em janeiro entrou tudo e não saiu nada: o caixa mostra dinheiro que não é
  // nosso, e é o resultado que diz o quanto de fato ganhamos.
  assert.equal(janeiro.summary.cash.netCents, ALUGUEL);
  assert.equal(janeiro.summary.result.netCents, adminFeeCents);

  const fevereiro = await service.statement(TENANT, "2026-02");
  assert.equal(fevereiro.summary.cash.netCents, -payoutCents);
  assert.equal(fevereiro.summary.result.netCents, 0, "o repasse não é despesa nossa");

  // Somando os dois meses, a identidade volta a fechar.
  assert.equal(
    janeiro.summary.cash.netCents + fevereiro.summary.cash.netCents,
    adminFeeCents,
  );
});

test("repasse cancelado apaga a taxa junto — a fonte de verdade é uma só", async () => {
  const mes = "2025-11";
  const { receivableId } = await cicloDeAluguel({
    competence: mes,
    paidAt: `${mes}-05`,
  });

  const antes = await service.statement(TENANT, mes);
  assert.ok(antes.summary.adminFeeCents > 0);

  const repasse = await repasseDe(receivableId);
  await payableRepo.updatePayable(TENANT, repasse.id, { status: "CANCELADO" });

  const depois = await service.statement(TENANT, mes);
  assert.equal(
    depois.summary.adminFeeCents,
    0,
    "a taxa é derivada do repasse: cancelar um tem que apagar a outra",
  );
});
