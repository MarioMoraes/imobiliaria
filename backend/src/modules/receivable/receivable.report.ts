import {
  brl,
  emptyBody,
  esc,
  pct,
  reportPage,
  type ReportBox,
} from "../../shared/report-html.js";
import { dayLabel, periodLabel, type Period } from "../../shared/period.js";
import type { Receivable } from "./receivable.schema.js";

/**
 * HTML do Relatório de Receitas — função **pura** (sem banco, sem tenant), para
 * o layout poder ser testado sozinho. Mesmo desenho de `payable/report.ts`.
 *
 * O relatório é montado sobre o VENCIMENTO, não sobre a baixa: ele existe para
 * responder "o que eu tinha a receber no período e quanto disso entrou". A
 * diferença entre previsto e recebido é a inadimplência — o número que some num
 * relatório feito só com o que foi pago.
 */

const KIND: Record<string, string> = {
  ALUGUEL: "Aluguel",
  CONDOMINIO: "Condomínio",
  IPTU: "IPTU",
  MULTA: "Multa",
  OUTRO: "Outros",
};

const SITUACAO: Record<string, string> = {
  ABERTO: "Em aberto",
  PAGO: "Pago",
  VENCIDO: "Vencido",
  CANCELADO: "Cancelado",
  ESTORNADO: "Estornado",
};

export interface RevenueReportInput {
  tenantName: string;
  period: Period;
  receivables: Receivable[];
  /** Data de emissão (injetada para o teste ser determinístico). */
  generatedAt: Date;
}

const previsto = (linhas: Receivable[]): number =>
  linhas.reduce((total, r) => total + r.amountCents, 0);

const recebido = (linhas: Receivable[]): number =>
  linhas.reduce(
    (total, r) => total + (r.status === "PAGO" ? (r.paidAmountCents ?? r.amountCents) : 0),
    0,
  );

const emAberto = (linhas: Receivable[]): number =>
  linhas.reduce((total, r) => total + (r.status === "PAGO" ? 0 : r.amountCents), 0);

/**
 * Vencido é DERIVADO da data, não lido do `status`.
 *
 * Não há agendador que vire `ABERTO` em `VENCIDO` à meia-noite: a parcela só
 * muda de estado quando alguém a toca. Confiar na coluna faria o relatório
 * emitido hoje jurar que nada está atrasado.
 */
function estaVencido(r: Receivable, hoje: string): boolean {
  return r.status !== "PAGO" && r.dueDate < hoje;
}

/** Agrupa por natureza da cobrança, preservando a ordem de vencimento do SQL. */
function agrupar(receivables: Receivable[]): { nome: string; linhas: Receivable[] }[] {
  const grupos = new Map<string, { nome: string; linhas: Receivable[] }>();
  for (const r of receivables) {
    const grupo = grupos.get(r.kind);
    if (grupo) grupo.linhas.push(r);
    else grupos.set(r.kind, { nome: KIND[r.kind] ?? r.kind, linhas: [r] });
  }
  return [...grupos.values()].sort((a, b) => previsto(b.linhas) - previsto(a.linhas));
}

export function toRevenueReportHtml(input: RevenueReportInput): string {
  const { receivables } = input;
  const hoje = input.generatedAt.toISOString().slice(0, 10);

  const totalPrevisto = previsto(receivables);
  const totalRecebido = recebido(receivables);
  const totalAberto = emAberto(receivables);
  const vencidas = receivables.filter((r) => estaVencido(r, hoje));
  const totalVencido = previsto(vencidas);

  const grupos = agrupar(receivables)
    .map((grupo) => {
      const corpo = grupo.linhas
        .map((r) => {
          const pago = r.status === "PAGO";
          const atrasada = estaVencido(r, hoje);
          return `
        <tr>
          <td class="num">${dayLabel(r.dueDate)}</td>
          <td>${esc(r.payerName ?? "—")}</td>
          <td class="num fraco">${esc(r.competence)}</td>
          <td class="fraco">${esc(r.description)}</td>
          <td class="val">${brl(r.amountCents)}</td>
          <td class="val strong">${pago ? brl(r.paidAmountCents ?? r.amountCents) : ""}</td>
          <td class="num">${dayLabel(r.paidAt)}</td>
          <td class="num${atrasada ? " neg" : ""}">
            ${atrasada ? "Vencido" : (SITUACAO[r.status] ?? esc(r.status))}
          </td>
        </tr>`;
        })
        .join("");

      return `
        <tbody class="grupo">
          <tr class="titulo"><th colspan="8">${esc(grupo.nome)}</th></tr>
          ${corpo}
          <tr class="subtotal">
            <td colspan="4">Subtotal · ${grupo.linhas.length} cobrança(s)</td>
            <td class="val">${brl(previsto(grupo.linhas))}</td>
            <td class="val strong">${brl(recebido(grupo.linhas))}</td>
            <td colspan="2"></td>
          </tr>
        </tbody>`;
    })
    .join("");

  const boxes: ReportBox[] = [
    { label: "Previsto no período", value: brl(totalPrevisto) },
    { label: "Recebido", value: brl(totalRecebido), strong: true },
    { label: "Em aberto", value: brl(totalAberto) },
    {
      label: `Vencido · ${vencidas.length} cobrança(s)`,
      value: brl(totalVencido),
    },
  ];

  const body = `
  <table>
    <!-- Larguras fixas: sem elas o Chromium espalha as colunas pelo conteúdo e
         os valores alinhados à direita encostam na coluna seguinte. -->
    <colgroup>
      <col style="width:9%"><col style="width:20%"><col style="width:8%">
      <col style="width:20%"><col style="width:12%"><col style="width:12%">
      <col style="width:9%"><col style="width:10%">
    </colgroup>
    <thead>
      <tr>
        <th>Vencimento</th><th>Pagador</th><th>Compet.</th><th>Descrição</th>
        <th class="val">Previsto</th><th class="val">Recebido</th>
        <th>Pagamento</th><th>Situação</th>
      </tr>
    </thead>
    ${
      receivables.length
        ? grupos
        : emptyBody(8, `Nenhuma cobrança vencendo entre ${periodLabel(input.period)}.`)
    }
    <tfoot>
      <tr>
        <td colspan="4">Total geral · ${receivables.length} cobrança(s)</td>
        <td class="val">${brl(totalPrevisto)}</td>
        <td class="val">${brl(totalRecebido)}</td>
        <td colspan="2" class="val fraco">
          ${totalPrevisto ? `${pct((totalRecebido / totalPrevisto) * 100)} recebido` : ""}
        </td>
      </tr>
    </tfoot>
  </table>`;

  return reportPage({
    tenantName: input.tenantName,
    title: "Relatório de Receitas",
    meta: `Vencimentos de ${periodLabel(input.period)} ·
           emitido em ${dayLabel(input.generatedAt.toISOString())} ·
           ${receivables.length} cobrança(s)`,
    boxes,
    body,
    landscape: true,
  });
}
