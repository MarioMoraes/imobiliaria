import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  attachTransfer,
  findByTransferId,
  insertOwnerPayouts,
  listPayables,
  summarize,
} from "./payable.repository.js";
import { applyTransferResult } from "./payable.service.js";
import { listPayablesQuerySchema } from "./payable.schema.js";
import type { OwnerPayout } from "./payable.schema.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI —
 * mais a idempotência do repasse, que é o que impede pagar o proprietário duas
 * vezes pelo mesmo aluguel.
 *
 * Depende da infra de pé: `npm run infra:up`.
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("payable")).id;
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

const ALL = listPayablesQuerySchema.parse({});

function payout(overrides: Partial<OwnerPayout> = {}): OwnerPayout {
  return {
    payeePersonId: randomUUID(),
    sharePercent: 100,
    grossCents: 300_000,
    adminFeePercent: 10,
    adminFeeCents: 30_000,
    amountCents: 270_000,
    dueDate: "2026-08-10",
    competence: "2026-07",
    description: "Repasse aluguel 2026-07",
    ...overrides,
  };
}

test("um repasse criado num tenant não é visível por outro tenant", async () => {
  const receivableId = randomUUID();
  const created = await insertOwnerPayouts(
    TENANT,
    { receivableId, contractId: null, propertyId: null },
    [payout()],
  );
  assert.equal(created, 1);

  const visibleToDemo = await listPayables(TENANT, ALL);
  assert.ok(
    visibleToDemo.some((p) => p.receivableId === receivableId),
    "o tenant dono deve enxergar o próprio repasse",
  );

  const visibleToOther = await listPayables(OTHER_TENANT, ALL);
  assert.ok(
    !visibleToOther.some((p) => p.receivableId === receivableId),
    "TENANT LEAKAGE: outro tenant não pode enxergar o repasse",
  );
});

test("reprocessar a mesma baixa não paga o proprietário duas vezes", async () => {
  const receivableId = randomUUID();
  const owners = [payout({ sharePercent: 60 }), payout({ sharePercent: 40 })];
  const origin = { receivableId, contractId: null, propertyId: null };

  const first = await insertOwnerPayouts(TENANT, origin, owners);
  assert.equal(first, 2, "a primeira geração cria um lançamento por dono");

  const second = await insertOwnerPayouts(TENANT, origin, owners);
  assert.equal(second, 0, "a segunda não cria nada (único receivable_id+dono)");

  const rows = await listPayables(TENANT, ALL);
  const forThisRent = rows.filter((p) => p.receivableId === receivableId);
  assert.equal(forThisRent.length, 2, "continuam existindo só os dois repasses");
});

test("o mesmo proprietário recebe por aluguéis diferentes", async () => {
  // A idempotência é por (receivable_id, dono) — dois meses do mesmo contrato
  // geram dois repasses para a mesma pessoa, e isso tem que continuar valendo.
  const personId = randomUUID();
  const julho = randomUUID();
  const agosto = randomUUID();

  await insertOwnerPayouts(TENANT, { receivableId: julho, contractId: null, propertyId: null }, [
    payout({ payeePersonId: personId, competence: "2026-07" }),
  ]);
  await insertOwnerPayouts(TENANT, { receivableId: agosto, contractId: null, propertyId: null }, [
    payout({ payeePersonId: personId, competence: "2026-08" }),
  ]);

  const rows = await listPayables(TENANT, ALL);
  const doAluguel: string[] = [julho, agosto];
  const forPerson = rows.filter(
    (p) => p.payeePersonId === personId && doAluguel.includes(p.receivableId ?? ""),
  );
  assert.equal(forPerson.length, 2);
});

test("o resumo do mês soma a taxa de administração como receita", async () => {
  // Meses distantes, para não colidir com outros testes. A taxa acompanha o
  // resto do resumo: entra no mês em que o repasse VENCE, para os quatro cards
  // descreverem o mesmo conjunto que a tabela lista.
  const dueMonth = "2029-04";
  const before = await summarize(TENANT, dueMonth);

  await insertOwnerPayouts(
    TENANT,
    { receivableId: randomUUID(), contractId: null, propertyId: null },
    [payout({ competence: "2029-03", dueDate: "2029-04-10", adminFeeCents: 30_000 })],
  );

  const after = await summarize(TENANT, dueMonth);
  assert.equal(
    after.adminFeeCents - before.adminFeeCents,
    30_000,
    "a taxa do repasse entra na receita do mês em que ele vence",
  );
});

test("o repasse conta no mês do VENCIMENTO, não no da competência", async () => {
  // O repasse vence no mês seguinte ao pagamento do aluguel, e é o vencimento
  // que manda: "A pagar no mês" é o que sai do caixa naquele mês. O que os cards
  // e a listagem NÃO podem é usar recortes diferentes — foi o que fez um card
  // zerado aparecer logo acima da linha que ele deveria somar.
  const competence = "2029-07";
  const dueMonth = "2029-08";

  const antesCompetencia = await summarize(TENANT, competence);
  const antesVencimento = await summarize(TENANT, dueMonth);

  const receivableId = randomUUID();
  await insertOwnerPayouts(
    TENANT,
    { receivableId, contractId: null, propertyId: null },
    [payout({ competence, dueDate: "2029-08-10", amountCents: 135_000 })],
  );

  const depoisVencimento = await summarize(TENANT, dueMonth);
  assert.equal(
    depoisVencimento.openCents - antesVencimento.openCents,
    135_000,
    "entra em 'a pagar' no mês em que vence",
  );

  // E não no mês da competência, senão o mesmo valor seria contado duas vezes.
  const depoisCompetencia = await summarize(TENANT, competence);
  assert.equal(
    depoisCompetencia.openCents,
    antesCompetencia.openCents,
    "não conta no mês da competência do aluguel",
  );

  // A listagem tem que usar o mesmo recorte dos cards. Ancorado no receivableId
  // recém-criado: o banco de teste é compartilhado e acumula linhas entre runs,
  // então contar por valor daria falso negativo na segunda execução.
  const noVencimento = await listPayables(
    TENANT,
    listPayablesQuerySchema.parse({ dueMonth }),
  );
  assert.ok(
    noVencimento.some((p) => p.receivableId === receivableId),
    "a linha aparece na listagem do mesmo mês em que o card a soma",
  );

  const naCompetencia = await listPayables(
    TENANT,
    listPayablesQuerySchema.parse({ dueMonth: competence }),
  );
  assert.ok(
    !naCompetencia.some((p) => p.receivableId === receivableId),
    "e não aparece no mês da competência do aluguel",
  );
});

/** Cria um repasse e já o coloca em PROCESSANDO, como o envio ao Asaas faria. */
async function payableEmTransferencia(transferId: string): Promise<string> {
  const receivableId = randomUUID();
  await insertOwnerPayouts(
    TENANT,
    { receivableId, contractId: null, propertyId: null },
    [payout()],
  );
  const [row] = (await listPayables(TENANT, ALL)).filter(
    (p) => p.receivableId === receivableId,
  );
  await attachTransfer(TENANT, row!.id, {
    asaasTransferId: transferId,
    transferStatus: "PENDING",
  });
  return row!.id;
}

test("transferência enviada deixa o repasse em PROCESSANDO, não em PAGO", async () => {
  const transferId = `tr_${randomUUID()}`;
  await payableEmTransferencia(transferId);

  const found = await findByTransferId(TENANT, transferId);
  assert.equal(found?.status, "PROCESSANDO", "dinheiro em trânsito não é dinheiro pago");
  assert.equal(found?.transferStatus, "PENDING");
  assert.equal(found?.paidAt, null);
});

test("TRANSFER_DONE dá a baixa na data em que o dinheiro caiu", async () => {
  const transferId = `tr_${randomUUID()}`;
  await payableEmTransferencia(transferId);

  const done = await applyTransferResult(TENANT, transferId, {
    status: "DONE",
    effectiveDate: "2026-08-11",
  });
  assert.equal(done?.status, "PAGO");
  assert.equal(done?.paidAt, "2026-08-11", "a data do caixa é a do banco, não a do clique");
  assert.equal(done?.paidAmountCents, done?.amountCents);

  // Reentrega do mesmo webhook não pode reescrever a baixa.
  const again = await applyTransferResult(TENANT, transferId, {
    status: "DONE",
    effectiveDate: "2026-09-30",
  });
  assert.equal(again?.paidAt, "2026-08-11", "reentrega não move a data do pagamento");
});

test("TRANSFER_FAILED devolve o repasse a ABERTO com o motivo", async () => {
  const transferId = `tr_${randomUUID()}`;
  await payableEmTransferencia(transferId);

  const failed = await applyTransferResult(TENANT, transferId, {
    status: "FAILED",
    failReason: "Chave PIX inexistente",
  });
  // O dinheiro não saiu, então o repasse continua devido.
  assert.equal(failed?.status, "ABERTO");
  assert.equal(failed?.paidAt, null);
  assert.equal(failed?.transferFailedReason, "Chave PIX inexistente");
});

test("transferência desconhecida (feita fora do sistema) é ignorada", async () => {
  const applied = await applyTransferResult(TENANT, `tr_${randomUUID()}`, { status: "DONE" });
  assert.equal(applied, null);
});

test("o resumo de um tenant não enxerga os repasses do outro", async () => {
  const month = "2029-05";
  await insertOwnerPayouts(
    TENANT,
    { receivableId: randomUUID(), contractId: null, propertyId: null },
    [payout({ competence: month, dueDate: "2029-06-10" })],
  );

  const other = await summarize(OTHER_TENANT, month);
  assert.equal(other.adminFeeCents, 0, "TENANT LEAKAGE: receita vazou no resumo");
  assert.equal(other.openCents, 0, "TENANT LEAKAGE: valor em aberto vazou no resumo");
});
