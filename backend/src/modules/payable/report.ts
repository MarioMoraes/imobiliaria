import type { Payable, PayableSummary } from "./payable.schema.js";

/**
 * HTML do Relatório de Repasses — função **pura** (sem banco, sem tenant), para
 * o layout poder ser testado sozinho. O `htmlToPdf` (Gotenberg/Chromium) o
 * converte; por isso é CSS de impressão, não a folha de estilo do app.
 *
 * O relatório mostra o que a tela não mostra: bruto, taxa de administração e a
 * participação de cada dono, agrupados por proprietário com subtotal. É o
 * documento que a imobiliária confere antes de pagar e envia a quem cobra
 * prestação de contas.
 */

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-07" → "julho de 2026". */
function mesPorExtenso(month: string): string {
  const i = Number(month.slice(5, 7)) - 1;
  return `${MESES[i] ?? month} de ${month.slice(0, 4)}`;
}

/** "2026-08-10" → "10/08/2026". Sem passar por `Date` (evita fuso). */
function dia(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function pct(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

const SITUACAO: Record<string, string> = {
  ABERTO: "Em aberto",
  PROCESSANDO: "Processando",
  PAGO: "Pago",
  VENCIDO: "Vencido",
  CANCELADO: "Cancelado",
  ESTORNADO: "Estornado",
};

/**
 * Escapa o que vem do cadastro. Nome de proprietário e título de imóvel são
 * texto livre — sem isso, um `&` ou `<` no cadastro quebraria o documento.
 */
function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface PayoutReportInput {
  tenantName: string;
  /** Mês de VENCIMENTO dos repasses (YYYY-MM) — o recorte da tela. */
  month: string;
  payables: Payable[];
  summary: PayableSummary;
  /** Data de emissão (injetada para o teste ser determinístico). */
  generatedAt: Date;
}

interface Grupo {
  nome: string;
  linhas: Payable[];
}

/** Agrupa por proprietário preservando a ordem de vencimento já vinda do SQL. */
function agrupar(payables: Payable[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const p of payables) {
    const chave = p.payeePersonId;
    const grupo = grupos.get(chave);
    if (grupo) grupo.linhas.push(p);
    else grupos.set(chave, { nome: p.payeeName ?? "(sem nome)", linhas: [p] });
  }
  return [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

const soma = (linhas: Payable[], pick: (p: Payable) => number): number =>
  linhas.reduce((total, p) => total + pick(p), 0);

export function toPayoutReportHtml(input: PayoutReportInput): string {
  const { payables, summary } = input;
  const grupos = agrupar(payables);

  const bruto = soma(payables, (p) => p.grossCents);
  const taxa = soma(payables, (p) => p.adminFeeCents);
  const liquido = soma(payables, (p) => p.amountCents);

  const linhasHtml = grupos
    .map((grupo) => {
      const corpo = grupo.linhas
        .map(
          (p) => `
        <tr>
          <td class="num">${p.propertyCode ?? "—"}</td>
          <td class="num">${esc(p.competence)}</td>
          <td class="num">${pct(p.sharePercent)}</td>
          <td class="val">${brl(p.grossCents)}</td>
          <td class="val">${brl(p.adminFeeCents)}<span class="pct"> (${pct(p.adminFeePercent)})</span></td>
          <td class="val strong">${brl(p.amountCents)}</td>
          <td class="num">${dia(p.dueDate)}</td>
          <td class="num">${dia(p.paidAt)}</td>
          <td>${SITUACAO[p.status] ?? esc(p.status)}</td>
        </tr>`,
        )
        .join("");

      // Subtotal por proprietário: é por ele que a prestação de contas é feita.
      return `
        <tbody class="grupo">
          <tr class="titulo"><th colspan="9">${esc(grupo.nome)}</th></tr>
          ${corpo}
          <tr class="subtotal">
            <td colspan="3">Subtotal · ${grupo.linhas.length} repasse(s)</td>
            <td class="val">${brl(soma(grupo.linhas, (p) => p.grossCents))}</td>
            <td class="val">${brl(soma(grupo.linhas, (p) => p.adminFeeCents))}</td>
            <td class="val strong">${brl(soma(grupo.linhas, (p) => p.amountCents))}</td>
            <td colspan="3"></td>
          </tr>
        </tbody>`;
    })
    .join("");

  const vazio = `
    <tbody><tr><td colspan="9" class="vazio">
      Nenhum repasse vencendo em ${mesPorExtenso(input.month)}.
    </td></tr></tbody>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Relatório de Repasses — ${esc(input.tenantName)}</title>
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

  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 8px; text-transform: uppercase;
             letter-spacing: .4px; color: #64748b; border-bottom: 1px solid #cbd5e1;
             padding: 5px 6px; }
  td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
  .num { white-space: nowrap; }
  .val { text-align: right; white-space: nowrap; padding-right: 14px; }
  .strong { font-weight: 700; }
  .pct { color: #94a3b8; }
  /* Um proprietário não deve começar no fim da página e continuar na outra. */
  tbody.grupo { break-inside: avoid; }
  tr.titulo th { background: #f1f5f9; font-size: 10px; text-transform: none;
                 letter-spacing: 0; color: #0f172a; padding: 5px 6px;
                 border-bottom: 1px solid #cbd5e1; }
  tr.subtotal td { background: #f8fafc; font-size: 9px; color: #475569;
                   border-bottom: 1px solid #cbd5e1; }
  tfoot td { border-top: 2px solid #0f172a; padding-top: 6px; font-weight: 700; }
  .vazio { color: #64748b; padding: 14px 6px; }
  footer { margin-top: 14px; color: #94a3b8; font-size: 8px; }
</style>
</head>
<body>
  <header>
    <div class="marca">${esc(input.tenantName)}</div>
    <h1>Relatório de Repasses a Proprietários</h1>
    <div class="meta">
      Vencimentos de ${mesPorExtenso(input.month)} ·
      emitido em ${dia(input.generatedAt.toISOString())} ·
      ${payables.length} lançamento(s)
    </div>
  </header>

  <div class="resumo">
    <div class="box"><div class="rot">A pagar no mês</div><div class="val">${brl(summary.openCents)}</div></div>
    <div class="box"><div class="rot">Repassado no mês</div><div class="val">${brl(summary.paidCents)}</div></div>
    <div class="box"><div class="rot">Taxa de administração</div><div class="val">${brl(summary.adminFeeCents)}</div></div>
    <div class="box"><div class="rot">Em atraso</div><div class="val">${brl(summary.overdueCents)}</div></div>
  </div>

  <table>
    <!-- Larguras fixas: sem elas o Chromium espalha as colunas pela largura do
         conteúdo e os valores alinhados à direita encostam na coluna seguinte. -->
    <colgroup>
      <col style="width:7%"><col style="width:8%"><col style="width:7%">
      <col style="width:13%"><col style="width:16%"><col style="width:13%">
      <col style="width:12%"><col style="width:12%"><col style="width:12%">
    </colgroup>
    <thead>
      <tr>
        <th>Imóvel</th><th>Compet.</th><th>Part.</th>
        <th class="val">Bruto</th><th class="val">Taxa adm.</th><th class="val">Líquido</th>
        <th>Vencimento</th><th>Pagamento</th><th>Situação</th>
      </tr>
    </thead>
    ${grupos.length ? linhasHtml : vazio}
    <tfoot>
      <tr>
        <td colspan="3">Total geral · ${payables.length} repasse(s)</td>
        <td class="val">${brl(bruto)}</td>
        <td class="val">${brl(taxa)}</td>
        <td class="val">${brl(liquido)}</td>
        <td colspan="3"></td>
      </tr>
    </tfoot>
  </table>

  <footer>
    Bruto = parte do aluguel que cabe ao proprietário (rateada pela participação).
    Líquido = bruto menos a taxa de administração do contrato.
  </footer>
</body>
</html>`;
}
