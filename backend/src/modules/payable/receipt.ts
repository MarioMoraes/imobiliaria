import { moneyToWords } from "../../shared/extenso.js";
import type { Payable } from "./payable.schema.js";

/**
 * HTML do **Recibo de Repasse** — função pura (sem banco, sem tenant), como
 * `report.ts`. O `htmlToPdf` (Gotenberg/Chromium) converte.
 *
 * Por que existe mesmo quando o pagamento é PIX: o comprovante do banco prova
 * que saiu dinheiro, não *do que* ele é. O recibo é o documento que amarra o
 * valor ao aluguel, à competência e ao imóvel — é o que a imobiliária arquiva na
 * prestação de contas e o que o proprietário assina dando quitação.
 *
 * Um recibo pode cobrir VÁRIOS repasses do mesmo proprietário (é o par natural
 * do PIX único): a tabela lista cada lançamento e o valor por extenso é o total.
 */

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-08-02" → "2 de agosto de 2026". */
function dataPorExtenso(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  const mes = MESES[Number(m) - 1] ?? m;
  return `${Number(d)} de ${mes} de ${y}`;
}

/** "2026-07" → "julho/2026". */
function competencia(month: string | null): string {
  if (!month) return "—";
  const i = Number(month.slice(5, 7)) - 1;
  return `${MESES[i] ?? month}/${month.slice(0, 4)}`;
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

/** 11 dígitos → CPF, 14 → CNPJ; qualquer outra coisa sai como veio. */
function doc(value: string | null): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return value ?? "";
}

/** Nome de pessoa e razão social são texto livre — sem escape, um `&` quebra. */
function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface PayoutReceiptInput {
  tenantName: string;
  tenantCnpj: string | null;
  tenantCreci: string | null;
  payeeName: string;
  payeeCpfCnpj: string | null;
  /** Lançamentos cobertos — todos do mesmo proprietário, todos quitados. */
  payables: Payable[];
  /** Data de emissão (injetada para o teste ser determinístico). */
  generatedAt: Date;
}

const soma = (linhas: Payable[], pick: (p: Payable) => number): number =>
  linhas.reduce((total, p) => total + pick(p), 0);

/**
 * Forma do pagamento por lançamento: transferência do Asaas ⇒ PIX; o resto veio
 * de baixa manual, e aí a imobiliária é quem sabe (não inventamos o meio).
 */
function formaDePagamento(payables: Payable[]): string {
  const pix = payables.filter((p) => p.asaasTransferId).length;
  if (pix === payables.length) return "PIX";
  if (pix === 0) return "conforme baixa registrada";
  return "PIX (parcial) e baixa registrada";
}

export function toPayoutReceiptHtml(input: PayoutReceiptInput): string {
  const { payables } = input;
  const total = soma(payables, (p) => p.paidAmountCents ?? p.amountCents);
  const bruto = soma(payables, (p) => p.grossCents);
  const taxa = soma(payables, (p) => p.adminFeeCents);

  // A data do recibo é a do PAGAMENTO, não a da impressão: é ela que dá
  // quitação. Com vários lançamentos, vale a do último dinheiro a entrar.
  const pagamentos = payables.map((p) => p.paidAt).filter((d): d is string => !!d).sort();
  const dataQuitacao = pagamentos.at(-1) ?? input.generatedAt.toISOString().slice(0, 10);

  const linhas = payables
    .map(
      (p) => `
      <tr>
        <td>${p.propertyCode ?? "—"}</td>
        <td>${esc(competencia(p.competence))}</td>
        <td class="val">${brl(p.grossCents)}</td>
        <td class="val">${brl(p.adminFeeCents)}</td>
        <td class="val strong">${brl(p.paidAmountCents ?? p.amountCents)}</td>
        <td class="num">${dia(p.paidAt)}</td>
      </tr>`,
    )
    .join("");

  const identificacaoPagador = [
    input.tenantCnpj ? `CNPJ ${doc(input.tenantCnpj)}` : null,
    input.tenantCreci ? `CRECI ${esc(input.tenantCreci)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Recibo de Repasse — ${esc(input.payeeName)}</title>
<style>
  @page { size: A4 portrait; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         font-size: 11px; color: #1e293b; margin: 0; }
  header { border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 18px; }
  .marca { font-size: 15px; font-weight: 700; }
  .meta { color: #64748b; font-size: 9px; margin-top: 3px; }

  .faixa { display: flex; align-items: baseline; justify-content: space-between;
           border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 14px;
           margin-bottom: 16px; }
  .faixa h1 { font-size: 16px; letter-spacing: 2px; margin: 0; }
  .faixa .valor { font-size: 20px; font-weight: 700; }

  .corpo { line-height: 1.65; text-align: justify; margin-bottom: 16px; }
  .corpo strong { font-weight: 700; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  thead th { text-align: left; font-size: 8px; text-transform: uppercase;
             letter-spacing: .4px; color: #64748b; border-bottom: 1px solid #cbd5e1;
             padding: 5px 6px; }
  td { padding: 5px 6px; border-bottom: 1px solid #f1f5f9; }
  .val { text-align: right; white-space: nowrap; }
  .num { white-space: nowrap; }
  .strong { font-weight: 700; }
  tfoot td { border-top: 1px solid #0f172a; font-weight: 700; padding-top: 6px; }

  .assinatura { margin-top: 54px; text-align: center; }
  .assinatura .linha { border-top: 1px solid #0f172a; width: 320px; margin: 0 auto 5px; }
  .assinatura .nome { font-weight: 700; }
  .assinatura .doc { color: #64748b; font-size: 9px; }
  .local { margin-top: 26px; text-align: right; }
  footer { margin-top: 28px; color: #94a3b8; font-size: 8px;
           border-top: 1px solid #e2e8f0; padding-top: 6px; }
</style>
</head>
<body>
  <header>
    <div class="marca">${esc(input.tenantName)}</div>
    <div class="meta">${identificacaoPagador || "Administradora de imóveis"}</div>
  </header>

  <div class="faixa">
    <h1>RECIBO</h1>
    <div class="valor">${brl(total)}</div>
  </div>

  <p class="corpo">
    Recebi de <strong>${esc(input.tenantName)}</strong>${
      input.tenantCnpj ? `, inscrita no CNPJ sob o nº ${doc(input.tenantCnpj)},` : ","
    }
    a importância de <strong>${brl(total)}</strong> (${moneyToWords(total)}),
    referente ao repasse de aluguel ${
      payables.length > 1
        ? `dos ${payables.length} lançamentos relacionados abaixo`
        : "do lançamento relacionado abaixo"
    },
    já deduzida a taxa de administração, pago por ${formaDePagamento(payables)},
    dando plena e geral quitação pelo valor recebido.
  </p>

  <table>
    <colgroup>
      <col style="width:12%"><col style="width:18%"><col style="width:19%">
      <col style="width:19%"><col style="width:19%"><col style="width:13%">
    </colgroup>
    <thead>
      <tr>
        <th>Imóvel</th><th>Competência</th>
        <th class="val">Aluguel (bruto)</th><th class="val">Taxa adm.</th>
        <th class="val">Líquido recebido</th><th>Pagamento</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
    <tfoot>
      <tr>
        <td colspan="2">Total · ${payables.length} lançamento(s)</td>
        <td class="val">${brl(bruto)}</td>
        <td class="val">${brl(taxa)}</td>
        <td class="val">${brl(total)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <div class="local">${dataPorExtenso(dataQuitacao)}.</div>

  <div class="assinatura">
    <div class="linha"></div>
    <div class="nome">${esc(input.payeeName)}</div>
    ${input.payeeCpfCnpj ? `<div class="doc">CPF/CNPJ ${doc(input.payeeCpfCnpj)}</div>` : ""}
  </div>

  <footer>Emitido em ${dia(input.generatedAt.toISOString())}.</footer>
</body>
</html>`;
}
