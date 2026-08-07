import assert from "node:assert/strict";
import { test } from "node:test";
import { toCashMovementReportHtml, toResultReportHtml } from "./cashflow.report.js";
import type { CashFlowMovement } from "./cashflow.schema.js";

/**
 * Os dois relatórios do fluxo de caixa lêem a MESMA lista de movimentos e
 * precisam somar coisas diferentes — é aí que mora o erro que ninguém confere:
 * um caixa que inclui a taxa de administração (dinheiro contado duas vezes) ou
 * um resultado que inclui o aluguel de terceiros (receita inflada em uma ordem
 * de grandeza).
 *
 * HTML puro: sem banco, sem Gotenberg.
 */

/**
 * `toLocaleString("pt-BR")` separa o "R$" do valor com um espaço NÃO-quebrável
 * (U+00A0) — correto no PDF, e invisível aqui. Sem normalizar, `"R$ 150,00"`
 * digitado no teste nunca casaria com o HTML e a falha não diria por quê.
 */
const norm = (html: string): string => html.replace(/[\u00a0\u202f]/g, " ");

function movement(over: Partial<CashFlowMovement> = {}): CashFlowMovement {
  return {
    key: "RECEBIMENTO:1",
    date: "2026-08-05",
    source: "RECEBIMENTO",
    direction: "ENTRADA",
    label: "Aluguel Recebido",
    description: "João da Silva · 2026-08",
    amountCents: 150_000,
    affectsCash: true,
    affectsResult: false,
    categoryId: null,
    categoryName: null,
    sourceId: "1",
    ...over,
  };
}

/** O cenário canônico: aluguel de R$ 1.500 com 10% de taxa, repassado no mês. */
const CENARIO: CashFlowMovement[] = [
  movement(),
  movement({
    key: "TAXA_ADM:1",
    source: "TAXA_ADM",
    label: "Taxa de Administração",
    amountCents: 15_000,
    affectsCash: false,
    affectsResult: true,
  }),
  movement({
    key: "REPASSE:1",
    date: "2026-08-20",
    source: "REPASSE",
    direction: "SAIDA",
    label: "Repasse ao Proprietário",
    amountCents: 135_000,
    affectsCash: true,
    affectsResult: false,
  }),
  movement({
    key: "MANUAL:1",
    date: "2026-08-28",
    source: "MANUAL",
    direction: "SAIDA",
    label: "Lançamento Manual",
    categoryName: "Aluguel do escritório",
    amountCents: 5_000,
    affectsCash: true,
    affectsResult: true,
  }),
];

const base = {
  tenantName: "Imobiliária Modelo & Cia",
  period: { from: "2026-08-01", to: "2026-08-31" },
  pendingPayoutCents: 0,
  generatedAt: new Date("2026-09-01T12:00:00.000Z"),
};

test("movimento do caixa soma só o que passa pelo banco", () => {
  const html = norm(toCashMovementReportHtml({ ...base, movements: CENARIO }));

  // Entradas = só o aluguel (R$ 1.500). A taxa de administração NÃO entra: ela
  // já veio dentro do aluguel, e somá-la aqui contaria o mesmo dinheiro 2×.
  assert.match(html, /Entradas<\/div>\s*<div class="val">R\$ 1\.500,00/);
  // Saídas = repasse (1.350) + despesa manual (50).
  assert.match(html, /Saídas<\/div>\s*<div class="val">R\$ 1\.400,00/);
  assert.match(html, /Saldo do período<\/div>\s*<div class="val destaque">R\$ 100,00/);

  assert.ok(!html.includes("Taxa de Administração"), "taxa de adm. não é caixa");
  assert.ok(html.includes("3 movimento(s)"));
});

test("movimento do caixa acumula o saldo linha a linha", () => {
  const html = norm(toCashMovementReportHtml({ ...base, movements: CENARIO }));
  // 1.500 → 150,00 (após o repasse de 1.350) → 100,00 (após a despesa de 50).
  const saldos = [...html.matchAll(/class="val strong[^"]*">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(saldos, ["R$ 1.500,00", "R$ 150,00", "R$ 100,00"]);
});

test("saldo negativo sai entre parênteses e marcado", () => {
  const html = norm(
    toCashMovementReportHtml({
      ...base,
      movements: [CENARIO[2]!], // só o repasse: o período começa no vermelho
    }),
  );
  assert.match(html, /class="val strong neg">\(R\$ 1\.350,00\)/);
});

test("resultados ignoram o dinheiro de terceiros", () => {
  const html = norm(toResultReportHtml({ ...base, movements: CENARIO }));

  // Receita = só a taxa de administração; despesa = só o lançamento próprio.
  assert.match(html, /Receitas<\/div>\s*<div class="val">R\$ 150,00/);
  assert.match(html, /Despesas<\/div>\s*<div class="val">R\$ 50,00/);
  assert.match(html, /Resultado<\/div>\s*<div class="val destaque">R\$ 100,00/);

  // O aluguel e o repasse (os dois lados do dinheiro de terceiros) ficam fora.
  assert.ok(!html.includes("Aluguel Recebido"));
  assert.ok(!html.includes("Repasse ao Proprietário"));
  // Lançamento manual agrupa pela CATEGORIA, não pelo rótulo genérico.
  assert.ok(html.includes("Aluguel do escritório"));
});

test("a evolução mês a mês só aparece com mais de um mês no período", () => {
  const umMes = norm(toResultReportHtml({ ...base, movements: CENARIO }));
  assert.ok(!umMes.includes("Evolução mês a mês"));

  const doisMeses = toResultReportHtml({
    ...base,
    period: { from: "2026-08-01", to: "2026-09-30" },
    movements: [...CENARIO, movement({
      key: "TAXA_ADM:2",
      date: "2026-09-04",
      source: "TAXA_ADM",
      label: "Taxa de Administração",
      amountCents: 20_000,
      affectsCash: false,
      affectsResult: true,
    })],
  });
  assert.ok(doisMeses.includes("Evolução mês a mês"));
  assert.ok(doisMeses.includes("ago/2026"));
  assert.ok(doisMeses.includes("set/2026"));
});

test("período sem movimento não vira tabela vazia sem explicação", () => {
  const html = norm(toCashMovementReportHtml({ ...base, movements: [] }));
  assert.match(html, /Nenhum movimento de caixa entre 01\/08\/2026 a 31\/08\/2026/);
});

test("texto do cadastro é escapado", () => {
  const html = toResultReportHtml({
    ...base,
    movements: [movement({
      key: "MANUAL:9",
      source: "MANUAL",
      direction: "SAIDA",
      categoryName: "Taxas <bancárias> & tarifas",
      amountCents: 1_000,
      affectsCash: true,
      affectsResult: true,
    })],
  });
  assert.ok(html.includes("Taxas &lt;bancárias&gt; &amp; tarifas"));
  assert.ok(html.includes("Imobiliária Modelo &amp; Cia"));
});
