import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCondoBilling, competenceOf, monthsInPeriod, type ActiveTenant } from "./condo-billing.js";
import type { Property } from "../property/property.schema.js";

/**
 * Cálculo da cobrança de condomínio. Função pura — não precisa de banco.
 * Roda com: node --import tsx --test backend/src/modules/condominium/condo-billing.test.ts
 */

/** Imóvel mínimo para o cálculo; o resto do Property não é lido aqui. */
function property(over: Partial<Property> & { id: string }): Property {
  return {
    code: null,
    title: "Imóvel",
    address: null,
    number: null,
    condoFeeCents: null,
    owners: [],
    ...over,
  } as Property;
}

const NO_TENANTS = new Map<string, ActiveTenant>();
const NONE_BILLED = new Set<string>();

test("meses do período contam meses-calendário tocados", () => {
  assert.equal(monthsInPeriod("2026-03-01", "2026-03-31"), 1);
  assert.equal(monthsInPeriod("2026-03-01", "2026-05-31"), 3);
  // Encostou em abril → abril inteiro: o valor do condomínio é mensal.
  assert.equal(monthsInPeriod("2026-03-15", "2026-04-10"), 2);
  // Virada de ano.
  assert.equal(monthsInPeriod("2025-12-01", "2026-02-28"), 3);
});

test("competência é o mês de início do período", () => {
  assert.equal(competenceOf("2026-03-15"), "2026-03");
});

test("rateio igual: a soma das linhas fecha com o total lançado", () => {
  const properties = [
    property({ id: "a" }),
    property({ id: "b" }),
    property({ id: "c" }),
  ];

  // 10.000 centavos / 3 = 3.333,33… — o resto não pode evaporar.
  const lines = buildCondoBilling({
    properties,
    tenantByProperty: NO_TENANTS,
    expensesTotalCents: 10_000,
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    billedPropertyIds: NONE_BILLED,
  });

  const soma = lines.reduce((s, l) => s + l.expenseShareCents, 0);
  assert.equal(soma, 10_000, "o rateio precisa somar exatamente o total lançado");
  assert.deepEqual(
    lines.map((l) => l.expenseShareCents),
    [3_334, 3_333, 3_333],
    "o resto vai para a primeira unidade",
  );
});

test("valor da conta = rateio + condomínio × meses do período", () => {
  const [line] = buildCondoBilling({
    properties: [property({ id: "a", condoFeeCents: 50_000 })],
    tenantByProperty: NO_TENANTS,
    expensesTotalCents: 30_000,
    periodStart: "2026-03-01",
    periodEnd: "2026-05-31",
    billedPropertyIds: NONE_BILLED,
  });

  assert.equal(line!.months, 3);
  assert.equal(line!.condoTotalCents, 150_000, "3 × 500,00");
  assert.equal(line!.expenseShareCents, 30_000, "unidade única absorve tudo");
  assert.equal(line!.totalCents, 180_000);
});

test("imóvel alugado cobra do inquilino; sem contrato, do proprietário", () => {
  const alugado = property({
    id: "alugado",
    owners: [{ id: "o1", personId: "dono-1", personName: "Ana Dona", sharePercent: 100 }],
  });
  const vago = property({
    id: "vago",
    owners: [{ id: "o2", personId: "dono-2", personName: "Bruno Dono", sharePercent: 100 }],
  });

  const lines = buildCondoBilling({
    properties: [alugado, vago],
    tenantByProperty: new Map([
      ["alugado", { personId: "inq-1", personName: "Carla Inquilina" }],
    ]),
    expensesTotalCents: 0,
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    billedPropertyIds: NONE_BILLED,
  });

  assert.equal(lines[0]!.payerKind, "LOCATARIO");
  assert.equal(lines[0]!.payerPersonId, "inq-1");
  assert.equal(lines[1]!.payerKind, "LOCADOR");
  assert.equal(lines[1]!.payerPersonId, "dono-2");
});

test("entre coproprietários, cobra do de maior participação", () => {
  const [line] = buildCondoBilling({
    properties: [
      property({
        id: "a",
        owners: [
          { id: "o1", personId: "menor", personName: "Ana", sharePercent: 30 },
          { id: "o2", personId: "maior", personName: "Zeca", sharePercent: 70 },
        ],
      }),
    ],
    tenantByProperty: NO_TENANTS,
    expensesTotalCents: 0,
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    billedPropertyIds: NONE_BILLED,
  });

  assert.equal(line!.payerPersonId, "maior");
});

test("imóvel sem contrato e sem dono fica sem pagador, mas entra no rateio", () => {
  const lines = buildCondoBilling({
    properties: [property({ id: "orfao" }), property({ id: "b" })],
    tenantByProperty: NO_TENANTS,
    expensesTotalCents: 10_000,
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    billedPropertyIds: NONE_BILLED,
  });

  assert.equal(lines[0]!.payerKind, null);
  assert.equal(lines[0]!.payerPersonId, null);
  // Tirá-lo do divisor jogaria a despesa dele nos vizinhos por um cadastro
  // incompleto — o rateio continua sendo entre TODAS as unidades.
  assert.equal(lines[1]!.expenseShareCents, 5_000);
});

test("imóvel já cobrado na competência vem marcado", () => {
  const lines = buildCondoBilling({
    properties: [property({ id: "a" }), property({ id: "b" })],
    tenantByProperty: NO_TENANTS,
    expensesTotalCents: 0,
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    billedPropertyIds: new Set(["a"]),
  });

  assert.equal(lines[0]!.alreadyBilled, true);
  assert.equal(lines[1]!.alreadyBilled, false);
});

test("condomínio sem imóveis não gera linha nenhuma", () => {
  const lines = buildCondoBilling({
    properties: [],
    tenantByProperty: NO_TENANTS,
    expensesTotalCents: 10_000,
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    billedPropertyIds: NONE_BILLED,
  });
  assert.deepEqual(lines, []);
});
