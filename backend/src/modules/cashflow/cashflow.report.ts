import {
  brl,
  brlSigned,
  emptyBody,
  esc,
  pct,
  reportPage,
  type ReportBox,
} from "../../shared/report-html.js";
import { dayLabel, monthLabel, periodLabel, type Period } from "../../shared/period.js";
import type { CashFlowMovement } from "./cashflow.schema.js";

/**
 * Os dois relatórios do fluxo de caixa em PDF — funções **puras** (sem banco,
 * sem tenant), como `payable/report.ts`.
 *
 * São documentos diferentes porque respondem a perguntas diferentes, e é a
 * mesma separação que a tela do fluxo de caixa faz com seus dois totalizadores
 * (ver o cabeçalho de `cashflow.schema.ts`):
 *
 * - **Movimento do Caixa** — o extrato. Lê `affectsCash`: entrou o aluguel
 *   inteiro, saiu o repasse inteiro. É o documento que se confere contra o
 *   extrato do banco.
 * - **Resultados** — o que sobra para a imobiliária. Lê `affectsResult`: taxa de
 *   administração, juros e multa, comissões e despesas próprias. É o documento
 *   que vai para a contabilidade.
 *
 * Emitir só um dos dois seria o erro clássico: o caixa do mês parece ótimo
 * porque o repasse ainda não saiu, e o resultado nunca foi aquilo.
 */

export interface CashFlowReportInput {
  tenantName: string;
  period: Period;
  movements: CashFlowMovement[];
  /** Dinheiro de terceiros ainda retido — explica o caixa maior que o resultado. */
  pendingPayoutCents: number;
  /** Data de emissão (injetada para o teste ser determinístico). */
  generatedAt: Date;
}

const soma = (movements: CashFlowMovement[], direction: "ENTRADA" | "SAIDA"): number =>
  movements
    .filter((m) => m.direction === direction)
    .reduce((total, m) => total + m.amountCents, 0);

function emitidoEm(generatedAt: Date): string {
  return dayLabel(generatedAt.toISOString());
}

/* ------------------------------------------------- Movimento do Caixa */

/**
 * Extrato do período, linha a linha, com saldo acumulado.
 *
 * O saldo é o do PERÍODO, e começa em zero — não é o saldo da conta bancária.
 * Puxar o saldo real exigiria um saldo de abertura por banco, que o sistema não
 * mantém (as contas de `banks` derivam seus totais); um número apresentado como
 * "saldo" sem essa base seria a conciliação bancária de mentira.
 */
export function toCashMovementReportHtml(input: CashFlowReportInput): string {
  const movements = input.movements.filter((m) => m.affectsCash);
  const entradas = soma(movements, "ENTRADA");
  const saidas = soma(movements, "SAIDA");

  let saldo = 0;
  const linhas = movements
    .map((m) => {
      const entrada = m.direction === "ENTRADA";
      saldo += entrada ? m.amountCents : -m.amountCents;
      return `
        <tr>
          <td class="num">${dayLabel(m.date)}</td>
          <td>${esc(m.label)}</td>
          <td class="fraco">${esc(m.description)}</td>
          <td class="val">${entrada ? brl(m.amountCents) : ""}</td>
          <td class="val">${entrada ? "" : brl(m.amountCents)}</td>
          <td class="val strong${saldo < 0 ? " neg" : ""}">${brlSigned(saldo)}</td>
        </tr>`;
    })
    .join("");

  const boxes: ReportBox[] = [
    { label: "Entradas", value: brl(entradas) },
    { label: "Saídas", value: brl(saidas) },
    { label: "Saldo do período", value: brlSigned(entradas - saidas), strong: true },
    { label: "Retido de terceiros", value: brl(input.pendingPayoutCents) },
  ];

  const body = `
  <table>
    <!-- Larguras fixas: sem elas o Chromium espalha as colunas pelo conteúdo e
         os valores alinhados à direita encostam na coluna seguinte. -->
    <colgroup>
      <col style="width:9%"><col style="width:21%"><col style="width:30%">
      <col style="width:13%"><col style="width:13%"><col style="width:14%">
    </colgroup>
    <thead>
      <tr>
        <th>Data</th><th>Natureza</th><th>Descrição</th>
        <th class="val">Entrada</th><th class="val">Saída</th><th class="val">Saldo</th>
      </tr>
    </thead>
    ${
      movements.length
        ? `<tbody>${linhas}</tbody>`
        : emptyBody(6, `Nenhum movimento de caixa entre ${periodLabel(input.period)}.`)
    }
    <tfoot>
      <tr>
        <td colspan="3">Total · ${movements.length} movimento(s)</td>
        <td class="val">${brl(entradas)}</td>
        <td class="val">${brl(saidas)}</td>
        <td class="val">${brlSigned(entradas - saidas)}</td>
      </tr>
    </tfoot>
  </table>`;

  return reportPage({
    tenantName: input.tenantName,
    title: "Relatório de Movimento do Caixa",
    meta: `Período de ${periodLabel(input.period)} ·
           emitido em ${emitidoEm(input.generatedAt)} ·
           ${movements.length} movimento(s)`,
    boxes,
    body,
  });
}

/* -------------------------------------------------------- Resultados */

interface Grupo {
  nome: string;
  valor: number;
}

/**
 * Agrupa o resultado por natureza. Lançamento manual agrupa pela categoria
 * cadastrada; origem automática, pelo próprio rótulo — que é o que quem lê o
 * relatório chama de categoria. Mesmo critério de `groupByCategory` no
 * repositório, replicado aqui porque o relatório é puro e não vai ao banco.
 */
function agrupar(movements: CashFlowMovement[], direction: "ENTRADA" | "SAIDA"): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const m of movements) {
    if (m.direction !== direction) continue;
    const nome = m.source === "MANUAL" ? (m.categoryName ?? "Sem categoria") : m.label;
    const atual = grupos.get(nome);
    if (atual) atual.valor += m.amountCents;
    else grupos.set(nome, { nome, valor: m.amountCents });
  }
  return [...grupos.values()].sort((a, b) => b.valor - a.valor);
}

function blocoCategorias(grupos: Grupo[], total: number, titulo: string): string {
  if (!grupos.length) {
    return `<section><h2>${esc(titulo)}</h2>
      <table>${emptyBody(3, "Nada lançado no período.")}</table></section>`;
  }

  const linhas = grupos
    .map(
      (g) => `
      <tr>
        <td>${esc(g.nome)}</td>
        <td class="val">${brl(g.valor)}</td>
        <td class="val fraco">${total ? pct((g.valor / total) * 100) : "—"}</td>
      </tr>`,
    )
    .join("");

  return `
  <section>
    <h2>${esc(titulo)}</h2>
    <table>
      <colgroup><col style="width:60%"><col style="width:22%"><col style="width:18%"></colgroup>
      <thead><tr><th>Natureza</th><th class="val">Valor</th><th class="val">% do total</th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr>
        <td>Total</td><td class="val">${brl(total)}</td><td class="val">100%</td>
      </tr></tfoot>
    </table>
  </section>`;
}

/**
 * Quebra mês a mês. Só aparece quando o período cobre mais de um mês: num
 * relatório de agosto sozinho, uma tabela de uma linha repetindo o rodapé só
 * ocuparia espaço.
 */
function blocoMeses(movements: CashFlowMovement[]): string {
  const meses = new Map<string, { entrada: number; saida: number }>();
  for (const m of movements) {
    const mes = m.date.slice(0, 7);
    const atual = meses.get(mes) ?? { entrada: 0, saida: 0 };
    if (m.direction === "ENTRADA") atual.entrada += m.amountCents;
    else atual.saida += m.amountCents;
    meses.set(mes, atual);
  }
  if (meses.size < 2) return "";

  const linhas = [...meses.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, v]) => {
      const liquido = v.entrada - v.saida;
      return `
      <tr>
        <td class="num">${monthLabel(mes)}</td>
        <td class="val">${brl(v.entrada)}</td>
        <td class="val">${brl(v.saida)}</td>
        <td class="val strong${liquido < 0 ? " neg" : ""}">${brlSigned(liquido)}</td>
      </tr>`;
    })
    .join("");

  return `
  <section>
    <h2>Evolução mês a mês</h2>
    <table>
      <colgroup><col style="width:28%"><col style="width:24%"><col style="width:24%"><col style="width:24%"></colgroup>
      <thead><tr>
        <th>Mês</th><th class="val">Receitas</th><th class="val">Despesas</th><th class="val">Resultado</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>
  </section>`;
}

/**
 * Demonstrativo de resultado do período: receitas e despesas PRÓPRIAS da
 * imobiliária, agrupadas por natureza, com a evolução mês a mês.
 *
 * O aluguel recebido e o repasse pago NÃO entram — os dois lados da mesma
 * passagem de dinheiro de terceiro se cancelariam e ainda inflariam receita e
 * despesa em centenas de milhares, escondendo a taxa de administração que é o
 * que a imobiliária de fato ganhou.
 */
export function toResultReportHtml(input: CashFlowReportInput): string {
  const movements = input.movements.filter((m) => m.affectsResult);
  const receitas = soma(movements, "ENTRADA");
  const despesas = soma(movements, "SAIDA");
  const resultado = receitas - despesas;
  const margem = receitas ? (resultado / receitas) * 100 : 0;

  const boxes: ReportBox[] = [
    { label: "Receitas", value: brl(receitas) },
    { label: "Despesas", value: brl(despesas) },
    { label: "Resultado", value: brlSigned(resultado), strong: true },
    { label: "Margem", value: receitas ? pct(margem) : "—" },
  ];

  const body = movements.length
    ? `${blocoCategorias(agrupar(movements, "ENTRADA"), receitas, "Receitas por natureza")}
       ${blocoCategorias(agrupar(movements, "SAIDA"), despesas, "Despesas por natureza")}
       ${blocoMeses(movements)}`
    : `<table>${emptyBody(3, `Nenhuma receita ou despesa própria entre ${periodLabel(input.period)}.`)}</table>`;

  return reportPage({
    tenantName: input.tenantName,
    title: "Relatório de Resultados",
    meta: `Período de ${periodLabel(input.period)} ·
           emitido em ${emitidoEm(input.generatedAt)} ·
           ${movements.length} lançamento(s)`,
    boxes,
    body,
  });
}
