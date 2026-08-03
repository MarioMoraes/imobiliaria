import assert from "node:assert/strict";
import { test } from "node:test";
import { toBillingReportHtml } from "./billing-report.js";
import type { CondoBillingLine, CondoBillingPreview, CondominiumExpense } from "./condominium.schema.js";

/**
 * O relatório é documento de conferência: é nele que se decide gerar (ou não) o
 * lote de contas. Estes testes cobrem o HTML puro (sem banco, sem Gotenberg) —
 * os valores exibidos e o que separa "a gerar" de "já gerada"/"sem pagador".
 */

function line(over: Partial<CondoBillingLine> = {}): CondoBillingLine {
  return {
    propertyId: "p1",
    propertyCode: 101,
    propertyAddress: "Rua A, 100",
    payerKind: "LOCATARIO",
    payerPersonId: "inq-1",
    payerName: "Carla Inquilina",
    months: 1,
    condoFeeCents: 50_000,
    condoTotalCents: 50_000,
    expenseShareCents: 15_000,
    totalCents: 65_000,
    alreadyBilled: false,
    ...over,
  };
}

function expense(over: Partial<CondominiumExpense> = {}): CondominiumExpense {
  return {
    id: "e1",
    tenantId: "t",
    condominiumId: "c1",
    seq: 7,
    entryDate: "2026-03-10",
    eventId: null,
    eventName: "Manutenção",
    amountCents: 30_000,
    notes: "Elevador & portaria",
    createdAt: "2026-03-10T10:00:00.000Z",
    updatedAt: "2026-03-10T10:00:00.000Z",
    ...over,
  };
}

function preview(over: Partial<CondoBillingPreview> = {}): CondoBillingPreview {
  return {
    condominiumId: "c1",
    condominiumName: "Residencial Ville de France",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    dueDate: "2026-04-10",
    competence: "2026-03",
    months: 1,
    unitCount: 2,
    expensesCount: 1,
    expensesTotalCents: 30_000,
    totalCents: 130_000,
    lines: [line(), line({ propertyId: "p2", propertyCode: 102 })],
    ...over,
  };
}

const base = { tenantName: "Imobiliária Modelo", generatedAt: new Date("2026-04-01T12:00:00Z") };

test("cabeçalho traz período, competência e vencimento", () => {
  const html = toBillingReportHtml({ ...base, preview: preview(), expenses: [expense()] });

  assert.match(html, /01\/03\/2026 a 31\/03\/2026/);
  assert.match(html, /competência março de 2026/);
  assert.match(html, /vencimento em 10\/04\/2026/);
  assert.match(html, /Residencial Ville de France/);
});

test("lista as despesas que formaram o rateio", () => {
  const html = toBillingReportHtml({
    ...base,
    preview: preview(),
    expenses: [expense(), expense({ id: "e2", seq: 8, amountCents: 10_000, notes: "Água" })],
  });

  assert.match(html, /Despesas rateadas no período \(2\)/);
  assert.match(html, /Manutenção/);
  assert.match(html, /Água/);
  // Texto do cadastro é livre: um "&" solto quebraria o documento.
  assert.match(html, /Elevador &amp; portaria/);
  assert.ok(!html.includes("Elevador & portaria"), "o & precisa sair escapado");
});

test("mostra a composição do valor de cada unidade", () => {
  const html = toBillingReportHtml({ ...base, preview: preview(), expenses: [expense()] });

  assert.match(html, /R\$\s*500,00/, "condomínio da unidade");
  assert.match(html, /R\$\s*150,00/, "rateio da unidade");
  assert.match(html, /R\$\s*650,00/, "total da unidade");
});

test("período de vários meses mostra o cálculo do condomínio", () => {
  const html = toBillingReportHtml({
    ...base,
    preview: preview({
      months: 3,
      periodEnd: "2026-05-31",
      lines: [line({ months: 3, condoTotalCents: 150_000, totalCents: 165_000 })],
    }),
    expenses: [expense()],
  });

  // "500,00 × 3" deixa o leitor refazer a conta sem abrir o cadastro do imóvel.
  assert.match(html, /R\$\s*500,00\s*×\s*3/);
});

test("separa a gerar de já gerada e sem pagador", () => {
  const html = toBillingReportHtml({
    ...base,
    preview: preview({
      unitCount: 3,
      lines: [
        line(),
        line({ propertyId: "p2", alreadyBilled: true }),
        line({ propertyId: "p3", payerKind: null, payerPersonId: null, payerName: null }),
      ],
    }),
    expenses: [expense()],
  });

  assert.match(html, /A gerar/);
  assert.match(html, /Já gerada/);
  assert.match(html, /Sem pagador/);
  // Só a primeira entra no bloco "A gerar" do resumo.
  assert.match(html, /A gerar \(1\)/);
});

test("condomínio sem imóveis e sem despesas não quebra o documento", () => {
  const html = toBillingReportHtml({
    ...base,
    preview: preview({ unitCount: 0, expensesCount: 0, expensesTotalCents: 0, totalCents: 0, lines: [] }),
    expenses: [],
  });

  assert.match(html, /Nenhuma despesa lançada no período/);
  assert.match(html, /Nenhum imóvel vinculado a este condomínio/);
});
