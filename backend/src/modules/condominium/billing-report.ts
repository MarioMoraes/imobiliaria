import type { CondoBillingPreview, CondominiumExpense } from "./condominium.schema.js";

/**
 * HTML do Relatório de Cobrança de Condomínio — função **pura** (sem banco, sem
 * tenant), para o layout poder ser testado sozinho. O `htmlToPdf`
 * (Gotenberg/Chromium) o converte; por isso é CSS de impressão, não a folha de
 * estilo do app.
 *
 * É o documento de CONFERÊNCIA, emitido antes de gerar as contas: mostra o que
 * a tela resume — a lista das despesas que formaram o rateio e, por unidade, a
 * composição do valor (condomínio × meses + rateio). Quem confere precisa poder
 * refazer a conta no papel.
 */

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-07" → "julho de 2026". */
function mesPorExtenso(competence: string): string {
  const i = Number(competence.slice(5, 7)) - 1;
  return `${MESES[i] ?? competence} de ${competence.slice(0, 4)}`;
}

/** "2026-08-10" → "10/08/2026". Sem passar por `Date` (evita fuso). */
function dia(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Escapa o que vem do cadastro. Nome de pessoa, endereço e histórico de despesa
 * são texto livre — sem isso, um `&` ou `<` no cadastro quebraria o documento.
 */
function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const PAGADOR: Record<string, string> = {
  LOCATARIO: "Inquilino",
  LOCADOR: "Proprietário",
};

export interface BillingReportInput {
  tenantName: string;
  preview: CondoBillingPreview;
  /** Despesas que compõem o rateio, na ordem da data. */
  expenses: CondominiumExpense[];
  /** Data de emissão (injetada para o teste ser determinístico). */
  generatedAt: Date;
}

export function toBillingReportHtml(input: BillingReportInput): string {
  const { preview, expenses } = input;

  const aGerar = preview.lines.filter((l) => l.payerPersonId && !l.alreadyBilled);
  const totalAGerar = aGerar.reduce((s, l) => s + l.totalCents, 0);

  const despesasHtml = expenses.length
    ? expenses
        .map(
          (e) => `
        <tr>
          <td class="num">${e.seq ?? "—"}</td>
          <td class="num">${dia(e.entryDate)}</td>
          <td>${esc(e.eventName) || "—"}</td>
          <td>${esc(e.notes) || "—"}</td>
          <td class="val">${brl(e.amountCents)}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="vazio">Nenhuma despesa lançada no período.</td></tr>`;

  const unidadesHtml = preview.lines.length
    ? preview.lines
        .map((l) => {
          // A situação é o que o conferente precisa ver antes de mandar gerar:
          // linha sem pagador ou já cobrada NÃO vira conta a receber.
          const situacao = !l.payerPersonId
            ? '<span class="alerta">Sem pagador</span>'
            : l.alreadyBilled
              ? '<span class="neutro">Já gerada</span>'
              : "A gerar";
          const composicao =
            l.months > 1
              ? `${brl(l.condoFeeCents)} × ${l.months}`
              : brl(l.condoFeeCents);
          return `
        <tr>
          <td class="num">${l.propertyCode ?? "—"}</td>
          <td>${esc(l.propertyAddress)}</td>
          <td>${PAGADOR[l.payerKind ?? ""] ?? "—"}</td>
          <td>${esc(l.payerName) || "—"}</td>
          <td class="val"><span class="calc">${composicao}</span> ${brl(l.condoTotalCents)}</td>
          <td class="val">${brl(l.expenseShareCents)}</td>
          <td class="val strong">${brl(l.totalCents)}</td>
          <td class="num">${situacao}</td>
        </tr>`;
        })
        .join("")
    : `<tr><td colspan="8" class="vazio">Nenhum imóvel vinculado a este condomínio.</td></tr>`;

  const rateioUnitario = preview.unitCount
    ? brl(Math.floor(preview.expensesTotalCents / preview.unitCount))
    : brl(0);

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Cobrança de Condomínio — ${esc(preview.condominiumName)}</title>
<style>
  @page { size: A4 landscape; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         font-size: 10px; color: #1e293b; margin: 0; }
  header { border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 14px; }
  .marca { font-size: 15px; font-weight: 700; }
  h1 { font-size: 12px; font-weight: 600; margin: 2px 0 0; }
  .meta { color: #64748b; font-size: 9px; margin-top: 3px; }

  .resumo { display: flex; gap: 8px; margin-bottom: 14px; }
  .box { flex: 1; border: 1px solid #e2e8f0; border-radius: 5px; padding: 7px 9px; }
  .box .rot { color: #64748b; font-size: 8px; text-transform: uppercase;
              letter-spacing: .4px; }
  .box .val { font-size: 13px; font-weight: 700; margin-top: 2px; }

  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .5px;
       color: #475569; margin: 0 0 5px; }
  section { margin-bottom: 16px; break-inside: avoid; }

  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 8px; text-transform: uppercase;
             letter-spacing: .4px; color: #64748b; border-bottom: 1px solid #cbd5e1;
             padding: 5px 6px; }
  td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
  .num { white-space: nowrap; }
  .val { text-align: right; white-space: nowrap; padding-right: 14px; }
  .strong { font-weight: 700; }
  .calc { color: #94a3b8; font-size: 8px; margin-right: 3px; }
  .alerta { color: #b45309; font-weight: 600; }
  .neutro { color: #94a3b8; }
  tfoot td { border-top: 2px solid #0f172a; padding-top: 6px; font-weight: 700; }
  .vazio { color: #64748b; padding: 14px 6px; }
  footer { margin-top: 14px; color: #94a3b8; font-size: 8px; }
</style>
</head>
<body>
  <header>
    <div class="marca">${esc(input.tenantName)}</div>
    <h1>Cobrança de Condomínio · ${esc(preview.condominiumName)}</h1>
    <div class="meta">
      Período de ${dia(preview.periodStart)} a ${dia(preview.periodEnd)} ·
      competência ${mesPorExtenso(preview.competence)} ·
      vencimento em ${dia(preview.dueDate)} ·
      emitido em ${dia(input.generatedAt.toISOString())}
    </div>
  </header>

  <div class="resumo">
    <div class="box"><div class="rot">Unidades</div><div class="val">${preview.unitCount}</div></div>
    <div class="box"><div class="rot">Despesas do período</div><div class="val">${brl(preview.expensesTotalCents)}</div></div>
    <div class="box"><div class="rot">Rateio por unidade</div><div class="val">${rateioUnitario}</div></div>
    <div class="box"><div class="rot">Total a cobrar</div><div class="val">${brl(preview.totalCents)}</div></div>
    <div class="box"><div class="rot">A gerar (${aGerar.length})</div><div class="val">${brl(totalAGerar)}</div></div>
  </div>

  <section>
    <h2>Despesas rateadas no período (${expenses.length})</h2>
    <table>
      <colgroup>
        <col style="width:8%"><col style="width:12%"><col style="width:22%">
        <col style="width:43%"><col style="width:15%">
      </colgroup>
      <thead>
        <tr>
          <th>Lancto nº</th><th>Data</th><th>Evento</th><th>Histórico</th>
          <th class="val">Valor</th>
        </tr>
      </thead>
      <tbody>${despesasHtml}</tbody>
      <tfoot>
        <tr>
          <td colspan="4">Total lançado no período</td>
          <td class="val">${brl(preview.expensesTotalCents)}</td>
        </tr>
      </tfoot>
    </table>
  </section>

  <section>
    <h2>Composição por unidade (${preview.lines.length})</h2>
    <table>
      <!-- Larguras fixas: sem elas o Chromium espalha as colunas pela largura do
           conteúdo e os valores alinhados à direita encostam na coluna seguinte. -->
      <colgroup>
        <col style="width:7%"><col style="width:24%"><col style="width:11%">
        <col style="width:19%"><col style="width:13%"><col style="width:10%">
        <col style="width:10%"><col style="width:9%">
      </colgroup>
      <thead>
        <tr>
          <th>Imóvel</th><th>Endereço</th><th>Cobrar de</th><th>Pagador</th>
          <th class="val">Condomínio</th><th class="val">Rateio</th>
          <th class="val">Total</th><th>Situação</th>
        </tr>
      </thead>
      <tbody>${unidadesHtml}</tbody>
      <tfoot>
        <tr>
          <td colspan="4">Total geral · ${preview.lines.length} unidade(s)</td>
          <td class="val">${brl(preview.lines.reduce((s, l) => s + l.condoTotalCents, 0))}</td>
          <td class="val">${brl(preview.expensesTotalCents)}</td>
          <td class="val">${brl(preview.totalCents)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </section>

  <footer>
    Condomínio = valor cadastrado no imóvel multiplicado pelos ${preview.months} mês(es)
    do período. Rateio = despesas lançadas no período divididas igualmente entre as
    ${preview.unitCount} unidade(s); a sobra em centavos fica na primeira, para a soma
    fechar com o total lançado. A conta é cobrada do inquilino quando há contrato de
    locação vigente e do proprietário quando não há.
  </footer>
</body>
</html>`;
}
