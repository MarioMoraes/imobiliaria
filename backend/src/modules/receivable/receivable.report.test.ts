import assert from "node:assert/strict";
import { test } from "node:test";
import { toRevenueReportHtml } from "./receivable.report.js";
import type { Receivable } from "./receivable.schema.js";

/**
 * O relatório existe para mostrar a diferença entre previsto e recebido — a
 * inadimplência. Um relatório montado só com o que foi pago fecharia sempre em
 * 100%, e é exatamente o número que ninguém confere. HTML puro: sem banco, sem
 * Gotenberg.
 */

const norm = (html: string): string => html.replace(/[\u00a0\u202f]/g, " ");

function receivable(over: Partial<Receivable> = {}): Receivable {
  return {
    id: "1",
    tenantId: "t",
    contractId: null,
    condominiumId: null,
    propertyId: null,
    payerPersonId: "p1",
    payerName: "João da Silva",
    kind: "ALUGUEL",
    description: "Aluguel 1/12",
    competence: "2026-08",
    installment: 1,
    installmentsTotal: 12,
    amountCents: 150_000,
    dueDate: "2026-08-05",
    status: "ABERTO",
    paidAt: null,
    paidAmountCents: null,
    asaasChargeId: null,
    boletoUrl: null,
    invoiceUrl: null,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...over,
  };
}

const base = {
  tenantName: "Imobiliária Modelo",
  period: { from: "2026-08-01", to: "2026-08-31" },
  generatedAt: new Date("2026-08-20T12:00:00.000Z"),
};

test("previsto, recebido, em aberto e vencido são recortes diferentes", () => {
  const html = norm(
    toRevenueReportHtml({
      ...base,
      receivables: [
        receivable({ id: "1", status: "PAGO", paidAt: "2026-08-04", paidAmountCents: 150_000 }),
        receivable({ id: "2", dueDate: "2026-08-10" }), // vencido em 20/08
        receivable({ id: "3", dueDate: "2026-08-28", amountCents: 100_000 }), // a vencer
      ],
    }),
  );

  assert.match(html, /Previsto no período<\/div>\s*<div class="val">R\$ 4\.000,00/);
  assert.match(html, /Recebido<\/div>\s*<div class="val destaque">R\$ 1\.500,00/);
  assert.match(html, /Em aberto<\/div>\s*<div class="val">R\$ 2\.500,00/);
  assert.match(html, /Vencido · 1 cobrança\(s\)<\/div>\s*<div class="val">R\$ 1\.500,00/);
});

test("juros e multa fazem o recebido superar o previsto da parcela", () => {
  const html = norm(
    toRevenueReportHtml({
      ...base,
      // Pagou R$ 1.600 numa parcela de R$ 1.500: o relatório mostra o que entrou,
      // não o que era devido.
      receivables: [
        receivable({ status: "PAGO", paidAt: "2026-08-12", paidAmountCents: 160_000 }),
      ],
    }),
  );
  assert.match(html, /Previsto no período<\/div>\s*<div class="val">R\$ 1\.500,00/);
  assert.match(html, /Recebido<\/div>\s*<div class="val destaque">R\$ 1\.600,00/);
});

test("vencido vem da data, não do status gravado", () => {
  const html = toRevenueReportHtml({
    ...base,
    receivables: [receivable({ dueDate: "2026-08-02", status: "ABERTO" })],
  });
  // A célula de situação (e não o rótulo do indicador, que diz "Em aberto" de
  // qualquer jeito): marcada como atraso, apesar do status ABERTO no banco.
  assert.match(html, /class="num neg">\s*Vencido/);
});

test("agrupa por natureza da cobrança, da maior para a menor", () => {
  const html = toRevenueReportHtml({
    ...base,
    receivables: [
      receivable({ id: "1", kind: "CONDOMINIO", amountCents: 30_000 }),
      receivable({ id: "2", kind: "ALUGUEL", amountCents: 150_000 }),
    ],
  });
  assert.ok(html.indexOf("Aluguel") < html.indexOf("Condomínio"), "aluguel pesa mais");
});

test("período sem cobrança explica o vazio", () => {
  const html = toRevenueReportHtml({ ...base, receivables: [] });
  assert.match(html, /Nenhuma cobrança vencendo entre 01\/08\/2026 a 31\/08\/2026/);
});
