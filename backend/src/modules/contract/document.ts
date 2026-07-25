/**
 * Conversão do conteúdo do modelo em um documento HTML para o Gotenberg.
 *
 * O modelo é escrito em **texto puro** — quem cadastra um contrato não precisa
 * saber HTML. A formatação (fonte serifada, corpo 12pt, parágrafos justificados)
 * é aplicada aqui, no momento da geração.
 *
 * Modelos legados escritos como documento HTML completo continuam funcionando:
 * a marcação é preservada, mas passa por `sanitizeDocumentHtml` — o Gotenberg
 * renderiza esse HTML num Chromium com acesso à rede interna, então nada no
 * documento pode buscar recurso externo.
 */

/** Folha de estilo padrão do contrato. As margens da página vêm do Gotenberg. */
const STYLE = `
  body { font-family: 'Times New Roman', Georgia, serif; font-size: 12pt; line-height: 1.5; color: #111; }
  p { text-align: justify; margin: 0 0 .75em; }
  p:empty { margin: 0; height: .75em; }
`;

/**
 * Só um documento HTML completo é tratado como HTML. Fragmentos soltos (um "<"
 * perdido no texto, por exemplo) são tratados como texto e escapados — o padrão
 * seguro, já que o conteúdo vem do usuário.
 */
export function isHtmlDocument(content: string): boolean {
  return /^\s*<(!doctype\s+html|html)\b/i.test(content);
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Ênfase leve no texto do modelo: `**negrito**` e `_itálico_`.
 *
 * Roda **depois** do escape (os marcadores não são afetados por ele) e **antes**
 * da substituição das variáveis — que acontece só na geração. Logo, um nome de
 * cadastro contendo `**` vira asterisco literal no documento, e não marcação:
 * dado de cliente não formata o contrato.
 *
 * Os marcadores não atravessam quebra de linha, senão um asterisco solto no
 * meio do texto emparelharia com outro páginas adiante.
 */
const applyEmphasis = (s: string): string =>
  s
    .replace(/\*\*([^\n*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^\n_]+)_(?=[\s.,;:!?)]|$)/gm, "$1<em>$2</em>");

/**
 * Texto puro → HTML. Linha em branco separa parágrafos; quebra simples vira
 * `<br>` (preserva endereços e listas de assinatura escritos linha a linha).
 * `**negrito**` e `_itálico_` são a única marcação aceita.
 *
 * O texto é escapado ANTES da substituição das variáveis, e os valores já vêm
 * escapados do catálogo — nenhum dado de cadastro consegue injetar marcação no
 * documento.
 */
/**
 * Remove do HTML tudo que faria o renderizador BUSCAR um recurso externo.
 *
 * Por que isto existe: o HTML do modelo é conteúdo de usuário (só exige
 * `contract:write`) e vai inteiro para o Gotenberg, que o renderiza num Chromium
 * **dentro da rede interna**. Sem saneamento, um
 * `<img src="http://169.254.169.254/latest/meta-data/...">` faz o servidor buscar
 * o recurso e o resultado é embutido no PDF que o autor baixa depois — SSRF com
 * exfiltração pelo próprio documento, alcançando metadata de nuvem e serviços
 * que só existem atrás do firewall.
 *
 * A regra é uma allow-list de esquema: `data:` (imagem embutida no próprio
 * modelo) e âncoras internas (`#`) passam; `http:`, `https:`, `file:`, `//host`
 * e afins são neutralizados. Aplica-se apenas ao caminho de HTML legado — o
 * caminho de texto puro já escapa tudo.
 */
const EXTERNAL_REF_ATTR = /\s(src|href|srcset|poster|data|background|action|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const CSS_URL = /url\(\s*(['"]?)(?!data:)[^)'"]*\1\s*\)/gi;
/** Elementos que só existem para trazer conteúdo de fora. */
const FETCHING_TAGS = /<\s*\/?\s*(iframe|frame|object|embed|link|script|base|applet)\b[^>]*>/gi;

function isSafeRef(value: string): boolean {
  const v = value.replace(/^["']|["']$/g, "").trim().toLowerCase();
  return v.startsWith("data:") || v.startsWith("#") || v === "";
}

export function sanitizeDocumentHtml(html: string): string {
  return html
    .replace(FETCHING_TAGS, "")
    .replace(EXTERNAL_REF_ATTR, (match, attr: string, value: string) =>
      isSafeRef(value) ? match : ` data-removido-${attr.toLowerCase()}=""`,
    )
    .replace(CSS_URL, "none");
}

export function toDocumentHtml(content: string): string {
  if (isHtmlDocument(content)) return sanitizeDocumentHtml(content);

  const paragraphs = applyEmphasis(escapeHtml(content.replace(/\r\n/g, "\n")))
    .split(/\n{2,}/)
    .map((block) => `<p>${block.trim().replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><style>${STYLE}</style></head>
<body>
${paragraphs}
</body></html>`;
}
