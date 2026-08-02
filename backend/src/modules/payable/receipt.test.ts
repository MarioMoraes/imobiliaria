import assert from "node:assert/strict";
import { test } from "node:test";
import { toPayoutReceiptHtml } from "./receipt.js";
import type { Payable } from "./payable.schema.js";

/**
 * O recibo é documento: o que ele afirma tem valor fora do sistema. Estes testes
 * cobrem o HTML puro (sem banco, sem Gotenberg) — valor, extenso e data de
 * quitação, que é onde um erro vira um papel errado na mão do proprietário.
 */

function payable(over: Partial<Payable> = {}): Payable {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenantId: "t",
    contractId: null,
    propertyId: null,
    receivableId: null,
    payeePersonId: "p1",
    payeeName: "Maria & Filhos",
    propertyCode: 7,
    kind: "REPASSE",
    description: "Repasse aluguel 2026-07",
    competence: "2026-07",
    sharePercent: 100,
    grossCents: 150_000,
    adminFeePercent: 10,
    adminFeeCents: 15_000,
    amountCents: 135_000,
    dueDate: "2026-09-05",
    status: "PAGO",
    paidAt: "2026-09-05",
    paidAmountCents: 135_000,
    asaasTransferId: null,
    transferStatus: null,
    transferFailedReason: null,
    createdAt: "2026-08-02T10:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    ...over,
  };
}

const base = {
  tenantName: "Imobiliária Modelo",
  tenantCnpj: "12345678000199",
  tenantCreci: "J-1234",
  payeeName: "João da Silva",
  payeeCpfCnpj: "12345678901",
  generatedAt: new Date("2026-09-10T12:00:00Z"),
};

test("o recibo traz o valor em número e por extenso", () => {
  const html = toPayoutReceiptHtml({ ...base, payables: [payable()] });

  assert.match(html, /R\$&nbsp;1\.350,00|R\$\s1\.350,00/);
  assert.match(html, /mil, trezentos e cinquenta reais/);
});

test("vários lançamentos do mesmo dono somam num recibo só", () => {
  const html = toPayoutReceiptHtml({
    ...base,
    payables: [
      payable({ id: "a", competence: "2026-06", paidAt: "2026-09-05" }),
      payable({ id: "b", competence: "2026-07", paidAt: "2026-09-08" }),
    ],
  });

  assert.match(html, /2 lançamentos relacionados abaixo/);
  assert.match(html, /2\.700,00/, "o valor por extenso e o total são a soma");
  // A quitação vale a partir do ÚLTIMO dinheiro a entrar: datar no primeiro
  // daria quitação a um valor que ainda não tinha sido pago inteiro.
  assert.match(html, /8 de setembro de 2026/);
});

test("PIX aparece como forma de pagamento quando houve transferência", () => {
  const pix = toPayoutReceiptHtml({
    ...base,
    payables: [payable({ asaasTransferId: "tr_1" })],
  });
  assert.match(pix, /pago por PIX/);

  const manual = toPayoutReceiptHtml({ ...base, payables: [payable()] });
  assert.match(manual, /conforme baixa registrada/);
});

test("nome com caractere de marcação não quebra o documento", () => {
  const html = toPayoutReceiptHtml({
    ...base,
    payeeName: "Maria & Filhos <Ltda>",
    payables: [payable()],
  });

  assert.match(html, /Maria &amp; Filhos &lt;Ltda&gt;/);
  assert.doesNotMatch(html, /<Ltda>/);
});

test("CPF e CNPJ saem mascarados", () => {
  const html = toPayoutReceiptHtml({ ...base, payables: [payable()] });
  assert.match(html, /123\.456\.789-01/);
  assert.match(html, /12\.345\.678\/0001-99/);
});
