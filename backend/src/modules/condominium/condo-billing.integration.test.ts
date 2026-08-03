import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { withTenant } from "../../shared/db.js";
import { createTestTenant } from "../../testing/tenants.js";
import { insertCondominium, insertExpense, updateCondominium } from "./condominium.repository.js";
import { insertPerson } from "../person/person.repository.js";
import { createPersonSchema } from "../person/person.schema.js";
import { addOwner, insertProperty } from "../property/property.repository.js";
import { createPropertySchema } from "../property/property.schema.js";
import { addParty, insertContract, updateContract } from "../contract/contract.repository.js";
import { createContractSchema } from "../contract/contract.schema.js";

/**
 * Cobrança de condomínio de ponta a ponta: prévia, geração e idempotência.
 *
 * O cenário é montado inteiro aqui — nada vem do seed. Um teste que dependesse
 * do seed se auto-pularia num tenant vazio e a cobertura sumiria em silêncio.
 * Depende da infra de pé (`npm run infra:up`).
 */
const TENANT = (await createTestTenant("condo-billing")).id;

const PERIOD = { periodStart: "2026-03-01", periodEnd: "2026-03-31", dueDate: "2026-04-10" };
const CONDO_FEE = 50_000; // R$ 500,00 por imóvel/mês
const EXPENSES = 30_000; // R$ 300,00 lançados no período → R$ 150,00 por unidade
const EXPENSES_FORA = 999_999; // lançada em maio: fora do rateio, dentro do saldo

let app: FastifyInstance;
let condominiumId: string;
let alugadoId: string;
let vagoId: string;
let inquilinoId: string;
let donoId: string;

before(async () => {
  app = await buildApp();

  const condominium = await insertCondominium(TENANT, {
    name: `Condomínio Cobrança ${Date.now()}`,
    adminFeePercent: 0,
    adminFeeFixedCents: 0,
    interestPercent: 0,
    penaltyPercent: 0,
  });
  condominiumId = condominium.id;

  // Os schemas zod aplicam os defaults do domínio — montar o objeto cru à mão
  // obrigaria a repetir aqui as ~30 flags que o repositório espera.
  const inquilino = await insertPerson(
    TENANT,
    createPersonSchema.parse({ roles: ["LOCATARIO"], fullName: "Carla Inquilina" }),
  );
  inquilinoId = inquilino.id;

  const dono = await insertPerson(
    TENANT,
    createPersonSchema.parse({ roles: ["LOCADOR"], fullName: "Bruno Proprietário" }),
  );
  donoId = dono.id;

  const alugado = await insertProperty(
    TENANT,
    createPropertySchema.parse({
      title: "Apto 101",
      status: "rented",
      condominiumId,
      condoFeeCents: CONDO_FEE,
    }),
  );
  alugadoId = alugado.id;

  const vago = await insertProperty(
    TENANT,
    createPropertySchema.parse({
      title: "Apto 102",
      status: "available",
      condominiumId,
      condoFeeCents: CONDO_FEE,
    }),
  );
  vagoId = vago.id;
  await addOwner(TENANT, vagoId, donoId, 100);

  // Contrato VIGENTE no primeiro imóvel — é ele que desvia a conta ao inquilino.
  const contrato = await insertContract(
    TENANT,
    createContractSchema.parse({ propertyId: alugadoId }),
  );
  await updateContract(TENANT, contrato.id, { status: "VIGENTE", startsAt: "2026-01-01" });
  await addParty(TENANT, contrato.id, "LOCATARIO", inquilinoId);

  await insertExpense(TENANT, condominiumId, {
    entryDate: "2026-03-10",
    amountCents: EXPENSES,
    notes: "Manutenção do elevador",
  });
  // Fora do período: não entra no rateio de março, mas conta no saldo — que é
  // acumulado, não do mês.
  await insertExpense(TENANT, condominiumId, {
    entryDate: "2026-05-10",
    amountCents: EXPENSES_FORA,
    notes: "Pintura (maio)",
  });
});

after(async () => {
  await app.close();
});

function preview() {
  const qs = new URLSearchParams(PERIOD).toString();
  return app.inject({
    method: "GET",
    url: `/v1/condominiums/${condominiumId}/billing?${qs}`,
    headers: { "x-tenant-id": TENANT, "x-dev-roles": "ADMIN" },
  });
}

function generate() {
  return app.inject({
    method: "POST",
    url: `/v1/condominiums/${condominiumId}/billing`,
    payload: PERIOD,
    headers: { "x-tenant-id": TENANT, "x-dev-roles": "ADMIN" },
  });
}

test("prévia rateia só as despesas do período e resolve o pagador de cada imóvel", async () => {
  const res = await preview();
  assert.equal(res.statusCode, 200);
  const data = res.json().data;

  assert.equal(data.competence, "2026-03");
  assert.equal(data.months, 1);
  assert.equal(data.unitCount, 2);
  assert.equal(data.expensesTotalCents, EXPENSES, "a despesa de maio não pode entrar");
  assert.equal(data.expensesCount, 1);

  const alugado = data.lines.find((l: { propertyId: string }) => l.propertyId === alugadoId);
  const vago = data.lines.find((l: { propertyId: string }) => l.propertyId === vagoId);

  assert.equal(alugado.payerKind, "LOCATARIO");
  assert.equal(alugado.payerPersonId, inquilinoId);
  assert.equal(vago.payerKind, "LOCADOR");
  assert.equal(vago.payerPersonId, donoId);

  // R$ 500,00 (condomínio × 1 mês) + R$ 150,00 (metade das despesas).
  assert.equal(alugado.totalCents, CONDO_FEE + EXPENSES / 2);
  assert.equal(data.totalCents, 2 * CONDO_FEE + EXPENSES);
});

test("prévia não grava nada", async () => {
  await preview();
  const { rows } = await withTenant(TENANT, (client) =>
    client.query("SELECT count(*)::int AS n FROM receivables WHERE kind = 'CONDOMINIO'"),
  );
  assert.equal(rows[0]!.n, 0);
});

test("gerar cria uma conta a receber por imóvel, com o pagador certo", async () => {
  const res = await generate();
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().data.created, 2);

  const { rows } = await withTenant(TENANT, (client) =>
    client.query<{ property_id: string; payer_person_id: string; amount_cents: string; due_date: string; competence: string }>(
      `SELECT property_id, payer_person_id, amount_cents, due_date::text AS due_date, competence
         FROM receivables WHERE kind = 'CONDOMINIO' ORDER BY property_id`,
    ),
  );
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(Number(row.amount_cents), CONDO_FEE + EXPENSES / 2);
    assert.equal(row.due_date, "2026-04-10", "o vencimento não pode escorregar por fuso");
    assert.equal(row.competence, "2026-03");
  }
  const porImovel = new Map(rows.map((r) => [r.property_id, r.payer_person_id]));
  assert.equal(porImovel.get(alugadoId), inquilinoId);
  assert.equal(porImovel.get(vagoId), donoId);
});

test("gerar o mesmo período de novo não duplica a cobrança", async () => {
  const res = await generate();
  assert.equal(res.statusCode, 200);
  const data = res.json().data;
  assert.equal(data.created, 0, "a segunda geração não pode criar nada");
  assert.ok(
    data.lines.every((l: { alreadyBilled: boolean }) => l.alreadyBilled),
    "a prévia precisa marcar as duas linhas como já cobradas",
  );

  const { rows } = await withTenant(TENANT, (client) =>
    client.query("SELECT count(*)::int AS n FROM receivables WHERE kind = 'CONDOMINIO'"),
  );
  assert.equal(rows[0]!.n, 2);
});

test("as cobranças geradas aparecem na lista de condôminos, com pagador e origem", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/v1/condominiums/${condominiumId}/charges`,
    headers: { "x-tenant-id": TENANT, "x-dev-roles": "ADMIN" },
  });

  assert.equal(res.statusCode, 200);
  const charges = res.json().data as {
    propertyId: string;
    condominiumId: string;
    contractId: string | null;
    payerName: string;
    kind: string;
    amountCents: number;
  }[];

  assert.equal(charges.length, 2);
  for (const c of charges) {
    assert.equal(c.kind, "CONDOMINIO");
    // `condominiumId` é o que liga a cobrança ao condomínio — sem ele a lista de
    // condôminos não acha o boleto, e o Asaas não acha juros/multa a aplicar.
    assert.equal(c.condominiumId, condominiumId);
    assert.equal(c.contractId, null, "cobrança de condomínio não é parcela do contrato");
    assert.equal(c.amountCents, CONDO_FEE + EXPENSES / 2);
  }
  const nomes = charges.map((c) => c.payerName).sort();
  assert.deepEqual(nomes, ["Bruno Proprietário", "Carla Inquilina"]);
});

test("saldo do condomínio: despesas debitam, pagamento credita", async () => {
  const condominiumService = await import("./condominium.service.js");
  const receivableService = await import("../receivable/receivable.service.js");

  // Antes de qualquer pagamento o condomínio está no vermelho pelas despesas.
  // TODAS elas, não só as do período cobrado: o saldo é o caixa acumulado.
  const gastoTotal = EXPENSES + EXPENSES_FORA;
  const inicial = await condominiumService.getById(TENANT, condominiumId);
  assert.equal(inicial.balanceCents, -gastoTotal, "despesas debitam o saldo");

  // Baixa de uma das cobranças (o mesmo caminho do webhook do Asaas).
  const charges = await receivableService.listCondoCharges(TENANT, condominiumId);
  const paga = charges[0]!;
  await receivableService.settle(TENANT, paga.id, { paidAmountCents: paga.amountCents });

  const depois = await condominiumService.getById(TENANT, condominiumId);
  assert.equal(
    depois.balanceCents,
    paga.amountCents - gastoTotal,
    "o valor recebido entra no saldo",
  );

  // Derivado, não somado: reler não credita de novo. É o que protege da
  // reentrega do webhook (o Asaas repete até receber 200).
  const relido = await condominiumService.getById(TENANT, condominiumId);
  assert.equal(relido.balanceCents, depois.balanceCents);

  // O saldo entra pelo que foi PAGO, não pelo que foi cobrado: pagamento com
  // juros/multa credita o valor real.
  const outra = charges[1]!;
  await receivableService.settle(TENANT, outra.id, {
    paidAmountCents: outra.amountCents + 5_000,
  });
  const comJuros = await condominiumService.getById(TENANT, condominiumId);
  assert.equal(comJuros.balanceCents, depois.balanceCents + outra.amountCents + 5_000);

  // A listagem calcula o mesmo saldo (lá é em lote, para não fazer N+1).
  const naLista = (await condominiumService.list(TENANT)).find((c) => c.id === condominiumId);
  assert.equal(naLista!.balanceCents, comJuros.balanceCents);
});

test("encargos do boleto de condomínio saem do cadastro do condomínio", async () => {
  const { chargeTerms } = await import("../payment/payment.service.js");

  // O condomínio deste teste nasceu com juros/multa zerados: sem percentual, o
  // boleto sai limpo em vez de mandar 0% ao provedor.
  const semEncargo = await chargeTerms(TENANT, { contractId: null, condominiumId });
  assert.deepEqual(semEncargo, {});

  await updateCondominium(TENANT, condominiumId, { interestPercent: 1, penaltyPercent: 2 });
  const comEncargo = await chargeTerms(TENANT, { contractId: null, condominiumId });
  assert.deepEqual(comEncargo, { fine: { value: 2 }, interest: { value: 1 } });

  // Sem nenhuma das duas origens não há o que cobrar por atraso.
  assert.deepEqual(await chargeTerms(TENANT, { contractId: null, condominiumId: null }), {});
});

test("relatório de conferência sai como PDF de verdade", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/v1/condominiums/${condominiumId}/billing/report?${new URLSearchParams(PERIOD).toString()}`,
    headers: { "x-tenant-id": TENANT, "x-dev-roles": "ADMIN" },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/pdf");
  // Assinatura do formato: um HTML de erro devolvido com o header certo passaria
  // por qualquer checagem que só olhasse o status.
  assert.equal(res.rawPayload.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("período invertido é recusado", async () => {
  const res = await app.inject({
    method: "POST",
    url: `/v1/condominiums/${condominiumId}/billing`,
    payload: { periodStart: "2026-03-31", periodEnd: "2026-03-01", dueDate: "2026-04-10" },
    headers: { "x-tenant-id": TENANT, "x-dev-roles": "ADMIN" },
  });
  assert.equal(res.statusCode, 400);
});

test("gerar exige permissão de financeiro (GESTOR só consulta)", async () => {
  const gerar = await app.inject({
    method: "POST",
    url: `/v1/condominiums/${condominiumId}/billing`,
    payload: PERIOD,
    headers: { "x-tenant-id": TENANT, "x-dev-roles": "GESTOR" },
  });
  assert.equal(gerar.statusCode, 403);

  const consultar = await app.inject({
    method: "GET",
    url: `/v1/condominiums/${condominiumId}/billing?${new URLSearchParams(PERIOD).toString()}`,
    headers: { "x-tenant-id": TENANT, "x-dev-roles": "GESTOR" },
  });
  assert.equal(consultar.statusCode, 200);
});
