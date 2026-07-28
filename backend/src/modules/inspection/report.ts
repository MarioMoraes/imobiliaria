import type { Inspection, InspectionEntry } from "./inspection.schema.js";

/**
 * HTML do Laudo de Vistoria — função **pura** (sem banco, sem tenant), para o
 * layout poder ser testado sozinho. O `htmlToPdf` (Gotenberg/Chromium) converte;
 * por isso é CSS de impressão, não a folha de estilo do app.
 *
 * O documento reproduz as colunas da tela: Cód · Descrição · Qtde · Bom · Médio
 * · Ruim · Observações. É o papel que vistoriador e locatário assinam na entrega
 * das chaves — daí as linhas de assinatura no rodapé.
 */

/** "2026-07-28" → "28/07/2026". Sem passar por `Date` (evita fuso). */
function dia(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Escapa o que vem do cadastro. Descrição do item e observação são texto livre —
 * sem isso, um `&` ou `<` digitado pelo usuário quebraria o documento.
 */
function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** "X" na coluna do estado marcado; vazio nas outras. */
function marca(entry: InspectionEntry, condition: string): string {
  return entry.condition === condition ? "X" : "";
}

export interface InspectionReportInput {
  tenantName: string;
  inspection: Inspection;
  entries: InspectionEntry[];
  property: { code: number | null; title: string; address: string };
  /** Data de emissão (injetada para o teste ser determinístico). */
  generatedAt: Date;
}

export function toInspectionReportHtml(input: InspectionReportInput): string {
  const { entries, inspection, property } = input;

  const linhas = entries
    .map(
      (e, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${esc(e.description)}</td>
          <td class="num">${e.quantity}</td>
          <td class="chk">${marca(e, "BOM")}</td>
          <td class="chk">${marca(e, "MEDIO")}</td>
          <td class="chk">${marca(e, "RUIM")}</td>
          <td>${esc(e.notes)}</td>
        </tr>`,
    )
    .join("");

  const vazio = `
    <tr><td colspan="7" class="vazio">
      Nenhum item de vistoria cadastrado. Cadastre-os em Tabelas › Itens de Vistoria.
    </td></tr>`;

  const observacoes = inspection.notes
    ? `<section class="obs"><div class="rot">Observações gerais</div><p>${esc(inspection.notes)}</p></section>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Vistoria — ${esc(property.title)}</title>
<style>
  @page { size: A4 portrait; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         font-size: 10px; color: #1e293b; margin: 0; }
  header { border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 14px; }
  .marca { font-size: 15px; font-weight: 700; }
  h1 { font-size: 12px; font-weight: 600; margin: 2px 0 0; }
  .meta { color: #64748b; font-size: 9px; margin-top: 3px; }

  .imovel { display: flex; gap: 8px; margin-bottom: 14px; }
  .box { border: 1px solid #e2e8f0; border-radius: 5px; padding: 7px 9px; }
  .box.wide { flex: 1; }
  .box .rot { color: #64748b; font-size: 8px; text-transform: uppercase;
              letter-spacing: .4px; }
  .box .val { font-size: 11px; font-weight: 600; margin-top: 2px; }

  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 8px; text-transform: uppercase;
             letter-spacing: .4px; color: #64748b; border-bottom: 1px solid #cbd5e1;
             padding: 5px 6px; }
  td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; }
  tr { break-inside: avoid; }
  .num { white-space: nowrap; text-align: right; }
  /* A caixa desenhada permite marcar à mão o que não foi preenchido no sistema. */
  .chk { text-align: center; font-weight: 700; }
  thead th.chk { text-align: center; }
  .vazio { color: #64748b; padding: 14px 6px; }

  .obs { margin-top: 14px; }
  .obs .rot { color: #64748b; font-size: 8px; text-transform: uppercase;
              letter-spacing: .4px; }
  .obs p { margin: 3px 0 0; white-space: pre-wrap; }

  .assinaturas { display: flex; gap: 40px; margin-top: 40px; break-inside: avoid; }
  .assinaturas div { flex: 1; border-top: 1px solid #0f172a; padding-top: 4px;
                     text-align: center; color: #475569; font-size: 9px; }
  footer { margin-top: 14px; color: #94a3b8; font-size: 8px; }
</style>
</head>
<body>
  <header>
    <div class="marca">${esc(input.tenantName)}</div>
    <h1>Laudo de Vistoria do Imóvel</h1>
    <div class="meta">
      Vistoria nº ${inspection.seq ?? "—"} ·
      emitido em ${dia(input.generatedAt.toISOString())} ·
      ${entries.length} item(ns)
    </div>
  </header>

  <div class="imovel">
    <div class="box"><div class="rot">Número</div><div class="val">${inspection.seq ?? "—"}</div></div>
    <div class="box"><div class="rot">Imóvel</div><div class="val">${property.code ?? "—"}</div></div>
    <div class="box wide"><div class="rot">Endereço</div><div class="val">${esc(property.address)}</div></div>
  </div>

  <table>
    <!-- Larguras fixas: sem elas o Chromium espalha as colunas pela largura do
         conteúdo e as caixas de estado ficam desalinhadas entre as linhas. -->
    <colgroup>
      <col style="width:5%"><col style="width:30%"><col style="width:7%">
      <col style="width:7%"><col style="width:7%"><col style="width:7%">
      <col style="width:37%">
    </colgroup>
    <thead>
      <tr>
        <th>Cód</th><th>Descrição</th><th class="num">Qtde</th>
        <th class="chk">Bom</th><th class="chk">Médio</th><th class="chk">Ruim</th>
        <th>Observações</th>
      </tr>
    </thead>
    <tbody>${entries.length ? linhas : vazio}</tbody>
  </table>

  ${observacoes}

  <div class="assinaturas">
    <div>Vistoriador</div>
    <div>Locatário</div>
    <div>Locador</div>
  </div>

  <footer>
    Documento gerado pelo sistema. O estado de cada item reflete a conferência
    feita na data de emissão.
  </footer>
</body>
</html>`;
}
