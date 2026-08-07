import {
  brl,
  emptyBody,
  esc,
  pct,
  reportPage,
  type ReportBox,
} from "../../shared/report-html.js";
import { dayLabel, periodLabel, type Period } from "../../shared/period.js";
import type { Payable } from "./payable.schema.js";

/**
 * HTML do Relatório de Contas a Pagar — função **pura** (sem banco, sem tenant),
 * como `report.ts` ao lado.
 *
 * NÃO é o mesmo documento que `report.ts`, embora leia a mesma tabela:
 *
 * - **Relatório de Repasses** (`report.ts`) — recorte de um MÊS de vencimento,
 *   agrupado por proprietário e detalhando bruto, taxa de administração e
 *   participação. É a prestação de contas que vai para o dono do imóvel.
 * - **Contas a Pagar** (aqui) — recorte de um PERÍODO livre, na visão de quem
 *   paga: o que vence, o que já saiu e o que está atrasado, agrupado por
 *   favorecido. É a agenda de pagamentos do financeiro.
 *
 * Por isso as colunas de rateio não aparecem aqui: quem programa a semana quer o
 * valor a transferir e a data, não a memória de cálculo.
 */

const SITUACAO: Record<string, string> = {
  ABERTO: "Em aberto",
  PROCESSANDO: "Processando",
  PAGO: "Pago",
  VENCIDO: "Vencido",
  CANCELADO: "Cancelado",
  ESTORNADO: "Estornado",
};

const KIND: Record<string, string> = {
  REPASSE: "Repasse ao proprietário",
  OUTRO: "Lançamento avulso",
};

export interface PayablePeriodReportInput {
  tenantName: string;
  period: Period;
  payables: Payable[];
  /** Data de emissão (injetada para o teste ser determinístico). */
  generatedAt: Date;
}

const total = (linhas: Payable[]): number =>
  linhas.reduce((soma, p) => soma + p.amountCents, 0);

const pago = (linhas: Payable[]): number =>
  linhas.reduce(
    (soma, p) => soma + (p.status === "PAGO" ? (p.paidAmountCents ?? p.amountCents) : 0),
    0,
  );

const aberto = (linhas: Payable[]): number =>
  linhas.reduce((soma, p) => soma + (p.status === "PAGO" ? 0 : p.amountCents), 0);

/**
 * Atrasado é DERIVADO da data, não lido do `status` — mesma razão do relatório
 * de receitas: nada vira `VENCIDO` sozinho à meia-noite, o lançamento só muda de
 * estado quando alguém o toca. `PROCESSANDO` conta como atrasado quando passa do
 * vencimento: a transferência foi enviada, mas o dinheiro ainda não chegou.
 */
function estaAtrasado(p: Payable, hoje: string): boolean {
  return p.status !== "PAGO" && p.dueDate < hoje;
}

/** Agrupa por favorecido, preservando a ordem de vencimento já vinda do SQL. */
function agrupar(payables: Payable[]): { nome: string; linhas: Payable[] }[] {
  const grupos = new Map<string, { nome: string; linhas: Payable[] }>();
  for (const p of payables) {
    const grupo = grupos.get(p.payeePersonId);
    if (grupo) grupo.linhas.push(p);
    else grupos.set(p.payeePersonId, { nome: p.payeeName ?? "(sem nome)", linhas: [p] });
  }
  return [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export function toPayablePeriodReportHtml(input: PayablePeriodReportInput): string {
  const { payables } = input;
  const hoje = input.generatedAt.toISOString().slice(0, 10);

  const totalPeriodo = total(payables);
  const totalPago = pago(payables);
  const totalAberto = aberto(payables);
  const atrasados = payables.filter((p) => estaAtrasado(p, hoje));

  const grupos = agrupar(payables)
    .map((grupo) => {
      const corpo = grupo.linhas
        .map((p) => {
          const quitado = p.status === "PAGO";
          const atrasado = estaAtrasado(p, hoje);
          return `
        <tr>
          <td class="num">${dayLabel(p.dueDate)}</td>
          <td class="num">${p.propertyCode ?? "—"}</td>
          <td class="num fraco">${esc(p.competence)}</td>
          <td class="fraco">${esc(p.description ?? KIND[p.kind] ?? p.kind)}</td>
          <td class="val">${brl(p.amountCents)}</td>
          <td class="val strong">${quitado ? brl(p.paidAmountCents ?? p.amountCents) : ""}</td>
          <td class="num">${dayLabel(p.paidAt)}</td>
          <td class="num${atrasado ? " neg" : ""}">
            ${atrasado ? "Atrasado" : (SITUACAO[p.status] ?? esc(p.status))}
          </td>
        </tr>`;
        })
        .join("");

      return `
        <tbody class="grupo">
          <tr class="titulo"><th colspan="8">${esc(grupo.nome)}</th></tr>
          ${corpo}
          <tr class="subtotal">
            <td colspan="4">Subtotal · ${grupo.linhas.length} lançamento(s)</td>
            <td class="val">${brl(total(grupo.linhas))}</td>
            <td class="val strong">${brl(pago(grupo.linhas))}</td>
            <td colspan="2"></td>
          </tr>
        </tbody>`;
    })
    .join("");

  const boxes: ReportBox[] = [
    { label: "Total do período", value: brl(totalPeriodo) },
    { label: "Pago", value: brl(totalPago) },
    { label: "A pagar", value: brl(totalAberto), strong: true },
    {
      label: `Atrasado · ${atrasados.length} lançamento(s)`,
      value: brl(total(atrasados)),
    },
  ];

  const body = `
  <table>
    <!-- Larguras fixas: sem elas o Chromium espalha as colunas pelo conteúdo e
         os valores alinhados à direita encostam na coluna seguinte. -->
    <colgroup>
      <col style="width:9%"><col style="width:7%"><col style="width:8%">
      <col style="width:24%"><col style="width:13%"><col style="width:13%">
      <col style="width:10%"><col style="width:11%">
    </colgroup>
    <thead>
      <tr>
        <th>Vencimento</th><th>Imóvel</th><th>Compet.</th><th>Descrição</th>
        <th class="val">Valor</th><th class="val">Pago</th>
        <th>Pagamento</th><th>Situação</th>
      </tr>
    </thead>
    ${
      payables.length
        ? grupos
        : emptyBody(8, `Nenhuma conta vencendo entre ${periodLabel(input.period)}.`)
    }
    <tfoot>
      <tr>
        <td colspan="4">Total geral · ${payables.length} lançamento(s)</td>
        <td class="val">${brl(totalPeriodo)}</td>
        <td class="val">${brl(totalPago)}</td>
        <td colspan="2" class="val fraco">
          ${totalPeriodo ? `${pct((totalPago / totalPeriodo) * 100)} quitado` : ""}
        </td>
      </tr>
    </tfoot>
  </table>`;

  return reportPage({
    tenantName: input.tenantName,
    title: "Relatório de Contas a Pagar",
    meta: `Vencimentos de ${periodLabel(input.period)} ·
           emitido em ${dayLabel(input.generatedAt.toISOString())} ·
           ${payables.length} lançamento(s)`,
    boxes,
    body,
    landscape: true,
  });
}
