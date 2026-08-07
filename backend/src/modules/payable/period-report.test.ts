import assert from "node:assert/strict";
import { test } from "node:test";
import { toPayablePeriodReportHtml } from "./period-report.js";
import type { Payable } from "./payable.schema.js";

/**
 * O que estes testes protegem é o "atrasado": ele é DERIVADO da data de emissão,
 * não lido da coluna `status`. Não há agendador virando ABERTO em VENCIDO à
 * meia-noite — confiar na coluna faria o relatório jurar que a carteira está em
 * dia. HTML puro: sem banco, sem Gotenberg.
 */

const norm = (html: string): string => html.replace(/[\u00a0\u202f]/g, " ");

function payable(over: Partial<Payable> = {}): Payable {
  return {
    id: "1",
    tenantId: "t",
    contractId: null,
    propertyId: null,
    receivableId: null,
    payeePersonId: "p1",
    payeeName: "Maria & Filhos",
    propertyCode: 7,
    kind: "REPASSE",
    description: "Repasse aluguel",
    competence: "2026-07",
    sharePercent: 100,
    grossCents: 150_000,
    adminFeePercent: 10,
    adminFeeCents: 15_000,
    amountCents: 135_000,
    dueDate: "2026-08-05",
    status: "ABERTO",
    paidAt: null,
    paidAmountCents: null,
    asaasTransferId: null,
    transferStatus: null,
    transferFailedReason: null,
    createdAt: "2026-07-02T10:00:00.000Z",
    updatedAt: "2026-07-02T10:00:00.000Z",
    ...over,
  };
}

const base = {
  tenantName: "Imobiliária Modelo",
  period: { from: "2026-08-01", to: "2026-08-31" },
  generatedAt: new Date("2026-08-20T12:00:00.000Z"),
};

test("separa pago, a pagar e atrasado", () => {
  const html = norm(
    toPayablePeriodReportHtml({
      ...base,
      payables: [
        payable({ id: "1", status: "PAGO", paidAt: "2026-08-04", paidAmountCents: 135_000 }),
        payable({ id: "2", dueDate: "2026-08-10" }), // vencido: 10/08 < 20/08
        payable({ id: "3", dueDate: "2026-08-28", amountCents: 50_000 }), // ainda vai vencer
      ],
    }),
  );

  assert.match(html, /Total do período<\/div>\s*<div class="val">R\$ 3\.200,00/);
  assert.match(html, /Pago<\/div>\s*<div class="val">R\$ 1\.350,00/);
  assert.match(html, /A pagar<\/div>\s*<div class="val destaque">R\$ 1\.850,00/);
  // Só o de 10/08 conta como atrasado — o de 28/08 ainda não venceu.
  assert.match(html, /Atrasado · 1 lançamento\(s\)<\/div>\s*<div class="val">R\$ 1\.350,00/);
});

test("atrasado vem da data, não do status gravado", () => {
  const html = toPayablePeriodReportHtml({
    ...base,
    // Status ABERTO no banco, mas o vencimento já passou: o relatório precisa
    // dizer "Atrasado", não "Em aberto".
    payables: [payable({ dueDate: "2026-08-02", status: "ABERTO" })],
  });
  // A célula de situação, marcada como atraso apesar do status ABERTO no banco.
  assert.match(html, /class="num neg">\s*Atrasado/);
});

test("transferência em trânsito vencida também está atrasada", () => {
  const html = toPayablePeriodReportHtml({
    ...base,
    payables: [payable({ dueDate: "2026-08-02", status: "PROCESSANDO" })],
  });
  // O PIX foi enviado, mas o dinheiro não chegou — para quem cobra, é atraso.
  assert.ok(html.includes("Atrasado"));
});

test("agrupa por favorecido com subtotal e escapa o cadastro", () => {
  const html = norm(
    toPayablePeriodReportHtml({
      ...base,
      payables: [
        payable({ id: "1" }),
        payable({ id: "2", payeePersonId: "p2", payeeName: "João <Souza>", amountCents: 40_000 }),
      ],
    }),
  );
  assert.ok(html.includes("Maria &amp; Filhos"));
  assert.ok(html.includes("João &lt;Souza&gt;"));
  assert.match(html, /Subtotal · 1 lançamento\(s\)<\/td>\s*<td class="val">R\$ 400,00/);
});

test("período sem lançamento explica o vazio", () => {
  const html = toPayablePeriodReportHtml({ ...base, payables: [] });
  assert.match(html, /Nenhuma conta vencendo entre 01\/08\/2026 a 31\/08\/2026/);
});
