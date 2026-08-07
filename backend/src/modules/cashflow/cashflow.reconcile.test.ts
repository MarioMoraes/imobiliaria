import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import * as condominiumRepo from "../condominium/condominium.repository.js";
import { createCondominiumSchema } from "../condominium/condominium.schema.js";
import * as receivableRepo from "../receivable/receivable.repository.js";
import { listReceivablesQuerySchema } from "../receivable/receivable.schema.js";
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
 * O último teste estende a mesma identidade ao CONDOMÍNIO, que é o caso em que
 * ela já esteve errada em produção: a cota do condômino entrava no caixa e a
 * despesa paga com ela não saía de lugar nenhum, então o saldo inflava para
 * sempre pelo total arrecadado.
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

/**
 * A mesma identidade, agora no condomínio — a regressão que este teste tranca.
 *
 * A cota do condômino é dinheiro de terceiro exatamente como o aluguel: entra
 * inteira e sai inteira, sem passar pelo resultado. O que fica retido é o saldo
 * do condomínio (arrecadado − gasto), e é ele que o indicador "A Repassar" tem
 * que somar ao repasse em aberto.
 *
 * Tenant próprio porque `pendingPayoutCents` é de TODOS os meses: os repasses
 * criados pelos testes acima entrariam na conta e mascarariam a asserção.
 */
test("condomínio: a cota entra, a despesa sai e o retido é o saldo do condomínio", async () => {
  const tenant = (await createTestTenant("cashflow-condominio")).id;
  const mes = "2026-06";
  const COTA = 143_750; // R$ 1.437,50 por unidade
  const DESPESA = 227_500; // R$ 2.275,00 pagos no mês

  const condominio = await condominiumRepo.insertCondominium(
    tenant,
    createCondominiumSchema.parse({ name: "Residencial do Teste" }),
  );

  // Duas unidades pelo caminho real do módulo (`insertCondoCharges`), e não por
  // um INSERT de conveniência: é a rota que a tela de cobrança usa.
  await receivableRepo.insertCondoCharges(
    tenant,
    condominio.id,
    [1, 2].map(() => ({
      propertyId: randomUUID(),
      payerPersonId: randomUUID(),
      description: "Condomínio",
      competence: mes,
      amountCents: COTA,
      dueDate: `${mes}-10`,
    })),
  );

  const cobrancas = await receivableRepo.listReceivables(
    tenant,
    listReceivablesQuerySchema.parse({ kind: "CONDOMINIO" }),
  );
  assert.equal(cobrancas.length, 2, "o cenário precisa das duas cotas");

  for (const cobranca of cobrancas) {
    await receivableRepo.updateReceivable(tenant, cobranca.id, {
      status: "PAGO",
      paidAt: `${mes}-05`,
      paidAmountCents: COTA,
    });
  }

  await condominiumRepo.insertExpense(tenant, condominio.id, {
    entryDate: `${mes}-06`,
    amountCents: DESPESA,
  });

  const { movements, summary } = await service.statement(tenant, mes);

  const despesa = movements.find((m) => m.source === "DESPESA_CONDOMINIO");
  assert.ok(despesa, "a despesa do condomínio precisa aparecer no extrato");
  assert.equal(despesa.amountCents, DESPESA);
  assert.equal(despesa.direction, "SAIDA");
  assert.equal(despesa.affectsCash, true, "o dinheiro sai da conta de verdade");
  assert.equal(despesa.affectsResult, false, "mas não é despesa da imobiliária");

  const arrecadado = COTA * 2;
  assert.equal(summary.cash.inflowCents, arrecadado);
  assert.equal(summary.cash.outflowCents, DESPESA);
  assert.equal(summary.result.netCents, 0, "condomínio não é receita nem despesa nossa");

  // O ponto do arquivo: o que sobra no caixa é EXATAMENTE o saldo do condomínio.
  // Sem o ramo da despesa, `cash.netCents` ficaria com o arrecadado inteiro.
  const retido = arrecadado - DESPESA;
  assert.equal(summary.cash.netCents, retido);
  assert.equal(
    summary.pendingPayoutCents,
    retido,
    "o saldo do condomínio é dinheiro de terceiro em mãos, como o repasse em aberto",
  );

  // E a identidade que a tela promete volta a fechar.
  assert.equal(
    summary.cash.netCents - summary.result.netCents,
    summary.pendingPayoutCents,
  );
});
