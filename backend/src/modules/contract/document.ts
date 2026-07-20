/**
 * Conversão do conteúdo do modelo em um documento HTML para o Gotenberg.
 *
 * O modelo é escrito em **texto puro** — quem cadastra um contrato não precisa
 * saber HTML. A formatação (fonte serifada, corpo 12pt, parágrafos justificados)
 * é aplicada aqui, no momento da geração.
 *
 * Modelos legados escritos como documento HTML completo continuam funcionando:
 * são repassados sem alteração (ver `isHtmlDocument`).
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
 * Texto puro → HTML. Linha em branco separa parágrafos; quebra simples vira
 * `<br>` (preserva endereços e listas de assinatura escritos linha a linha).
 *
 * O texto é escapado ANTES da substituição das variáveis, e os valores já vêm
 * escapados do catálogo — nenhum dado de cadastro consegue injetar marcação no
 * documento.
 */
export function toDocumentHtml(content: string): string {
  if (isHtmlDocument(content)) return content;

  const paragraphs = escapeHtml(content.replace(/\r\n/g, "\n"))
    .split(/\n{2,}/)
    .map((block) => `<p>${block.trim().replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><style>${STYLE}</style></head>
<body>
${paragraphs}
</body></html>`;
}
