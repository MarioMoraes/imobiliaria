import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import * as repo from "./commission.repository.js";
import * as service from "./commission.service.js";
import { listCommissionsQuerySchema } from "./commission.schema.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI —
 * mais a máquina de estados da comissão e a idempotência do fechamento da venda,
 * que é o que impede pagar o corretor duas vezes pelo mesmo negócio.
 *
 * Depende da infra de pé: `npm run infra:up`.
 */
import { createTestTenant } from "../../testing/tenants.js";

const TENANT = (await createTestTenant("commission")).id;
const OTHER_TENANT = (await createTestTenant("commission-outro")).id;
const ALL = listCommissionsQuerySchema.parse({});

let app: FastifyInstance;

before(async () => {
  app = await buildApp();
});

after(async () => {
  await app.close();
});

async function novaComissao(overrides: Record<string, unknown> = {}) {
  return repo.insertCommission(TENANT, {
    kind: "VENDA",
    party: "IMOBILIARIA",
    baseCents: 500_000_00,
    percent: 6,
    amountCents: 30_000_00,
    dueDate: "2026-08-10",
    ...overrides,
  } as Parameters<typeof repo.insertCommission>[1]);
}

test("uma comissão criada num tenant não é visível por outro", async () => {
  const criada = await novaComissao();

  assert.ok(
    (await repo.listCommissions(TENANT, ALL)).some((c) => c.id === criada.id),
    "o tenant dono deve enxergar a própria comissão",
  );
  assert.ok(
    !(await repo.listCommissions(OTHER_TENANT, ALL)).some((c) => c.id === criada.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar a comissão",
  );
});

test("a quitação registra a data do caixa e o valor efetivo", async () => {
  const criada = await novaComissao();
  const quitada = await service.settle(TENANT, criada.id, {
    settledAt: "2026-08-20",
    settledAmountCents: 29_500_00,
  });

  assert.equal(quitada.status, "QUITADO");
  assert.equal(quitada.settledAt, "2026-08-20");
  assert.equal(quitada.settledAmountCents, 29_500_00);
});

test("quitar duas vezes não reescreve a data da primeira", async () => {
  const criada = await novaComissao();
  await service.settle(TENANT, criada.id, { settledAt: "2026-08-20" });
  const segunda = await service.settle(TENANT, criada.id, { settledAt: "2026-09-30" });

  assert.equal(segunda.settledAt, "2026-08-20", "a baixa é idempotente");
});

test("comissão quitada não pode ser cancelada nem excluída", async () => {
  const criada = await novaComissao();
  await service.settle(TENANT, criada.id, {});

  await assert.rejects(
    () => service.cancel(TENANT, criada.id),
    /não pode ser cancelada/,
    "o dinheiro já se moveu; o mês fechado não pode mudar de valor",
  );
  await assert.rejects(() => service.remove(TENANT, criada.id), /não pode ser excluída/);
});

test("comissão cancelada não pode ser quitada", async () => {
  const criada = await novaComissao();
  await service.cancel(TENANT, criada.id);

  await assert.rejects(() => service.settle(TENANT, criada.id, {}), /não pode ser quitada/);
});

test("o fechamento da venda gera as duas partes e é idempotente", async () => {
  const saleId = "22222222-2222-2222-2222-222222222222";
  const broker = await criarCorretor(2);

  const criadas = await service.createForSale(TENANT, {
    saleId,
    propertyId: null,
    saleValueCents: 500_000_00,
    commissionPercent: 6,
    brokerId: broker.id,
    dueDate: "2026-08-10",
  });
  assert.equal(criadas, 2, "uma parte para a imobiliária, outra para o corretor");

  // Reprocessar o mesmo fechamento (webhook reentregue, botão clicado 2x).
  const denovo = await service.createForSale(TENANT, {
    saleId,
    propertyId: null,
    saleValueCents: 500_000_00,
    commissionPercent: 6,
    brokerId: broker.id,
    dueDate: "2026-08-10",
  });
  assert.equal(denovo, 0, "IDEMPOTÊNCIA: o corretor não pode ser pago duas vezes");

  const daVenda = await repo.listCommissions(
    TENANT,
    listCommissionsQuerySchema.parse({ saleId }),
  );
  assert.equal(daVenda.length, 2);
  assert.equal(daVenda.filter((c) => c.party === "IMOBILIARIA").length, 1);
  assert.equal(daVenda.filter((c) => c.party === "CORRETOR").length, 1);
});

test("a rota recusa comissão de corretor sem corretor", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/commissions",
    payload: {
      party: "CORRETOR",
      baseCents: 500_000_00,
      percent: 2,
      dueDate: "2026-08-10",
    },
    headers: { "x-tenant-id": TENANT, "x-dev-roles": "FINANCEIRO" },
  });

  assert.equal(res.statusCode, 400);
});

test("o resumo separa o que a imobiliária recebe do que paga ao corretor", async () => {
  const mes = "2026-12";
  const broker = await criarCorretor(2);

  const receita = await novaComissao({ dueDate: `${mes}-10` });
  const despesa = await repo.insertCommission(TENANT, {
    kind: "VENDA",
    party: "CORRETOR",
    brokerId: broker.id,
    baseCents: 500_000_00,
    percent: 2,
    amountCents: 10_000_00,
    dueDate: `${mes}-10`,
  } as Parameters<typeof repo.insertCommission>[1]);

  const emAberto = await service.summary(TENANT, mes);
  assert.equal(emAberto.receivableOpenCents, 30_000_00);
  assert.equal(emAberto.payableOpenCents, 10_000_00);

  await service.settle(TENANT, receita.id, { settledAt: `${mes}-15` });
  await service.settle(TENANT, despesa.id, { settledAt: `${mes}-15` });

  const quitadas = await service.summary(TENANT, mes);
  assert.equal(quitadas.receivedCents, 30_000_00);
  assert.equal(quitadas.paidCents, 10_000_00);
  assert.equal(quitadas.receivableOpenCents, 0, "nada mais em aberto no mês");
});

/** Corretor de apoio — o service valida que ele existe no tenant. */
async function criarCorretor(commissionPercent: number) {
  const { create } = await import("../broker/broker.service.js");
  return create(TENANT, {
    name: `Corretor ${commissionPercent}%`,
    commissionPercent,
  } as Parameters<typeof create>[1]);
}
