/**
 * Moldura comum dos relatórios em PDF do financeiro (Movimento do Caixa,
 * Resultados, Receitas e Contas a Pagar).
 *
 * São quatro documentos com o mesmo cabeçalho, a mesma faixa de indicadores e a
 * mesma tabela zebrada; o que muda é o miolo. Escrever o CSS de impressão quatro
 * vezes garantiria que o quarto relatório divergisse do primeiro na primeira
 * correção de espaçamento — e é justamente o tipo de diferença que o usuário
 * nota ao imprimir os quatro juntos.
 *
 * Funções **puras** (sem banco, sem tenant): o layout pode ser testado sozinho,
 * como já acontece em `payable/report.ts`. O `htmlToPdf` (Gotenberg/Chromium)
 * converte o resultado — por isso é CSS de impressão, não a folha do app.
 */

/**
 * Escapa o que vem do cadastro. Nome de pessoa, título de imóvel e descrição de
 * lançamento são texto livre — sem isso, um `&` ou `<` quebraria o documento.
 */
export function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Centavos → "R$ 1.234,56". */
export function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/**
 * Como `brl`, mas o negativo sai como "(R$ 10,00)" em vez de "-R$ 10,00".
 * Convenção contábil, e legível de longe numa coluna de resultado: o parêntese
 * salta aos olhos onde o hífen some entre os dígitos.
 */
export function brlSigned(cents: number): string {
  return cents < 0 ? `(${brl(-cents)})` : brl(cents);
}

export function pct(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/** Um indicador da faixa do topo. */
export interface ReportBox {
  label: string;
  value: string;
  /** Realça o número — o indicador que resume o documento. */
  strong?: boolean;
}

export interface ReportPageInput {
  tenantName: string;
  /** Nome do documento ("Relatório de Receitas"). */
  title: string;
  /** Período por extenso + contagem de linhas + data de emissão. */
  meta: string;
  boxes: ReportBox[];
  /** HTML do miolo (uma ou mais tabelas já montadas). */
  body: string;
  /** Nota de rodapé explicando como os números foram apurados. */
  footer?: string;
  /** Retrato é o padrão; paisagem para as tabelas de muitas colunas. */
  landscape?: boolean;
}

export function reportPage(input: ReportPageInput): string {
  const boxes = input.boxes
    .map(
      (box) => `
      <div class="box">
        <div class="rot">${esc(box.label)}</div>
        <div class="val${box.strong ? " destaque" : ""}">${box.value}</div>
      </div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(input.title)} — ${esc(input.tenantName)}</title>
<style>
  @page { size: A4 ${input.landscape ? "landscape" : "portrait"}; }
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
  .box .val.destaque { color: #0f172a; border-top: 2px solid #0f172a;
                       padding-top: 2px; margin-top: 3px; }

  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .6px;
       color: #475569; margin: 16px 0 6px; }
  /* Um bloco não deve começar no fim da página e continuar na outra. */
  section { break-inside: avoid; }

  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 8px; text-transform: uppercase;
             letter-spacing: .4px; color: #64748b; border-bottom: 1px solid #cbd5e1;
             padding: 5px 6px; }
  td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  .num { white-space: nowrap; }
  .val { text-align: right; white-space: nowrap; padding-right: 12px; }
  .strong { font-weight: 700; }
  .fraco { color: #94a3b8; }
  .neg { color: #b91c1c; }

  tbody.grupo { break-inside: avoid; }
  tr.titulo th { background: #f1f5f9; font-size: 10px; text-transform: none;
                 letter-spacing: 0; color: #0f172a; padding: 5px 6px;
                 border-bottom: 1px solid #cbd5e1; }
  tr.subtotal td { background: #f8fafc; font-size: 9px; color: #475569;
                   border-bottom: 1px solid #cbd5e1; }
  tfoot td { border-top: 2px solid #0f172a; padding-top: 6px; font-weight: 700; }
  .vazio { color: #64748b; padding: 14px 6px; }

  footer { margin-top: 14px; padding-top: 6px; border-top: 1px solid #e2e8f0;
           color: #94a3b8; font-size: 8px; }
</style>
</head>
<body>
  <header>
    <div class="marca">${esc(input.tenantName)}</div>
    <h1>${esc(input.title)}</h1>
    <div class="meta">${input.meta}</div>
  </header>

  ${input.boxes.length ? `<div class="resumo">${boxes}</div>` : ""}

  ${input.body}

  ${input.footer ? `<footer>${input.footer}</footer>` : ""}
</body>
</html>`;
}

/** Linha "nada encontrado" no lugar do corpo da tabela. */
export function emptyBody(colspan: number, message: string): string {
  return `<tbody><tr><td colspan="${colspan}" class="vazio">${esc(message)}</td></tr></tbody>`;
}
