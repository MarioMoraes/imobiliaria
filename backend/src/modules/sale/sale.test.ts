import assert from "node:assert/strict";
import { test } from "node:test";
import { insertProperty, findProperty } from "../property/property.repository.js";
import { createPropertySchema } from "../property/property.schema.js";
import * as commissionRepo from "../commission/commission.repository.js";
import { listCommissionsQuerySchema } from "../commission/commission.schema.js";
import * as repo from "./sale.repository.js";
import * as service from "./sale.service.js";
import { createSaleSchema } from "./sale.schema.js";
import { createTestTenant } from "../../testing/tenants.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI —
 * mais os efeitos do fechamento: o imóvel vira VENDIDO e a comissão nasce (sem
 * duplicar quando a venda é corrigida).
 *
 * Depende da infra de pé: `npm run infra:up`.
 */
const TENANT = (await createTestTenant("sale")).id;
const OTHER_TENANT = (await createTestTenant("sale-outro")).id;

/** Imóvel a vender montado no próprio teste — não depender do seed é regra. */
async function novoImovel(tenantId = TENANT) {
  return insertProperty(
    tenantId,
    createPropertySchema.parse({
      title: "Casa para o teste de venda",
      kind: "sale",
      purpose: "sale",
      status: "available",
      priceCents: 500_000_00,
    }),
  );
}

async function novoCorretor(commissionPercent: number) {
  const { create } = await import("../broker/broker.service.js");
  return create(TENANT, {
    name: `Corretor ${commissionPercent}%`,
    commissionPercent,
  } as Parameters<typeof create>[1]);
}

function dadosDaVenda(propertyId: string, overrides: Record<string, unknown> = {}) {
  return createSaleSchema.parse({
    propertyId,
    buyerName: "João Comprador",
    buyerCpf: "123.456.789-00",
    soldAt: "2026-08-10",
    valueCents: 500_000_00,
    commissionPercent: 6,
    ...overrides,
  });
}

test("uma venda criada num tenant não é visível por outro", async () => {
  const imovel = await novoImovel();
  const criada = await repo.insertSale(TENANT, dadosDaVenda(imovel.id));

  assert.ok(
    (await repo.listSales(TENANT, {})).some((s) => s.id === criada.id),
    "o tenant dono deve enxergar a própria venda",
  );
  assert.ok(
    !(await repo.listSales(OTHER_TENANT, {})).some((s) => s.id === criada.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar a venda",
  );
});

test("o código da venda é sequencial dentro do tenant", async () => {
  const tenant = (await createTestTenant("sale-seq")).id;
  const primeira = await repo.insertSale(
    tenant,
    dadosDaVenda((await novoImovel(tenant)).id),
  );
  const segunda = await repo.insertSale(
    tenant,
    dadosDaVenda((await novoImovel(tenant)).id),
  );

  assert.equal(primeira.code, 1);
  assert.equal(segunda.code, 2, "o segundo código é o MAX do tenant + 1");
});

test("registrar a venda marca o imóvel como vendido", async () => {
  const imovel = await novoImovel();
  await service.create(TENANT, dadosDaVenda(imovel.id));

  const depois = await findProperty(TENANT, imovel.id);
  assert.equal(depois?.status, "sold");
  assert.equal(depois?.isSold, true, "o campo Vendido da aba Venda acompanha a situação");
});

test("registrar a venda gera as duas partes da comissão, e corrigir não duplica", async () => {
  const imovel = await novoImovel();
  const corretor = await novoCorretor(2);

  const venda = await service.create(
    TENANT,
    dadosDaVenda(imovel.id, { brokerId: corretor.id }),
  );

  const daVenda = () =>
    commissionRepo.listCommissions(
      TENANT,
      listCommissionsQuerySchema.parse({ saleId: venda.id }),
    );

  const partes = await daVenda();
  assert.equal(partes.length, 2, "uma parte para a imobiliária, outra para o corretor");
  assert.equal(
    partes.find((c) => c.party === "IMOBILIARIA")?.amountCents,
    30_000_00,
    "6% de 500.000,00",
  );
  assert.equal(
    partes.find((c) => c.party === "CORRETOR")?.amountCents,
    10_000_00,
    "2% de 500.000,00",
  );

  // Corrigir um dado da venda re-tenta o fechamento: a idempotência do
  // `(sale_id, party, broker_id)` é o que impede pagar o corretor de novo.
  await service.update(TENANT, venda.id, { buyerName: "João Comprador da Silva" });
  assert.equal((await daVenda()).length, 2, "IDEMPOTÊNCIA: nenhuma parte a mais");
});

test("o UPDATE grava TODOS os campos editáveis", async () => {
  // O SET dinâmico casa a coluna do banco com a chave do input traduzindo
  // snake_case → camelCase. Um engano nessa tradução não quebra nada: o campo
  // simplesmente não é gravado, e o documento sai com a lacuna. Daí o teste
  // varrer a ficha inteira em vez de um campo só.
  const imovel = await novoImovel();
  const venda = await repo.insertSale(TENANT, dadosDaVenda(imovel.id));

  const patch = {
    soldAt: "2026-09-15",
    buyerName: "Maria Compradora",
    buyerNationality: "PORTUGUESA",
    buyerMaritalStatus: "CASADO" as const,
    buyerOccupation: "médica",
    buyerAddress: "Rua Nova, 12",
    buyerDistrict: "Vila Nova",
    buyerCity: "Campinas",
    buyerState: "SP",
    buyerZip: "13000-000",
    buyerCpf: "111.222.333-44",
    buyerRg: "22.333.444-5",
    spouseName: "Pedro Comprador",
    spouseNationality: "BRASILEIRA",
    spouseOccupation: "arquiteto",
    spouseCpf: "555.666.777-88",
    spouseRg: "33.444.555-6",
    marriageRegime: "comunhão parcial de bens",
    paymentNotes: "Sinal de 50.000,00 e o saldo em 360 meses",
    commissionPercent: 5,
    valueCents: 600_000_00,
  };

  const atualizada = await repo.updateSale(TENANT, venda.id, patch);
  assert.ok(atualizada);
  for (const [campo, esperado] of Object.entries(patch)) {
    assert.equal(
      (atualizada as unknown as Record<string, unknown>)[campo],
      esperado,
      `campo não gravado no UPDATE: ${campo}`,
    );
  }
});

test("um imóvel não aceita uma segunda venda", async () => {
  const imovel = await novoImovel();
  await service.create(TENANT, dadosDaVenda(imovel.id));

  await assert.rejects(
    () => service.create(TENANT, dadosDaVenda(imovel.id)),
    /já tem uma venda registrada/,
  );
});

test("apagar a venda devolve o imóvel à vitrine", async () => {
  const imovel = await novoImovel();
  const venda = await service.create(TENANT, dadosDaVenda(imovel.id));

  await service.remove(TENANT, venda.id);

  const depois = await findProperty(TENANT, imovel.id);
  assert.equal(depois?.status, "available");
  assert.equal(depois?.isSold, false);
  assert.equal(await service.findByProperty(TENANT, imovel.id), null);
});
