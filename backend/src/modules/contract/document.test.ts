import assert from "node:assert/strict";
import { test } from "node:test";
import { isHtmlDocument, toDocumentHtml } from "./document.js";
import { render } from "./merge-fields.js";

/** Puro (sem infra): modelo em texto puro → documento HTML para o Gotenberg. */

test("linha em branco separa parágrafos; quebra simples vira <br>", () => {
  const out = toDocumentHtml("Primeiro parágrafo.\n\nSegundo com\nduas linhas.");
  assert.ok(out.includes("<p>Primeiro parágrafo.</p>"));
  assert.ok(out.includes("<p>Segundo com<br>duas linhas.</p>"));
});

test("o texto do modelo é escapado (não vira marcação)", () => {
  const out = toDocumentHtml("Cláusula 5 < 10 & válida <b>não é negrito</b>");
  assert.ok(out.includes("5 &lt; 10 &amp; válida"));
  assert.ok(!out.includes("<b>"), "tags digitadas pelo usuário não devem virar HTML");
});

test("o documento sai completo e com a folha de estilo padrão", () => {
  const out = toDocumentHtml("Contrato.");
  assert.ok(out.startsWith("<!doctype html>"));
  assert.ok(out.includes("Times New Roman"));
  assert.ok(out.includes('charset="utf-8"'), "acentuação depende do charset");
});

test("modelo legado em HTML completo passa intacto", () => {
  const legacy = '<!doctype html><html><body><h1>Contrato</h1></body></html>';
  assert.equal(toDocumentHtml(legacy), legacy);
  assert.ok(isHtmlDocument(legacy));
  assert.ok(isHtmlDocument("\n  <HTML>\n<body>x</body></html>"), "tolera espaços e caixa alta");
});

test("fragmento solto NÃO é tratado como HTML (escapa, por segurança)", () => {
  assert.ok(!isHtmlDocument("<p>oi</p>"));
  assert.ok(toDocumentHtml("<p>oi</p>").includes("&lt;p&gt;oi&lt;/p&gt;"));
});

test("as variáveis sobrevivem à conversão e são substituídas", () => {
  const html = toDocumentHtml("LOCADOR: {{locador.nome}}, CPF {{ locador.cpf_cnpj }}.");
  const out = render(html, {
    "locador.nome": "João da Silva",
    "locador.cpf_cnpj": "123.456.789-00",
  } as never);
  assert.ok(out.includes("LOCADOR: João da Silva, CPF 123.456.789-00."));
});

test("valor com caractere especial não injeta marcação no documento", () => {
  // O catálogo já escapa os valores; o texto do modelo é escapado antes. A
  // combinação não pode gerar dupla codificação nem tag ativa.
  const html = toDocumentHtml("Nome: {{locador.nome}}");
  const out = render(html, { "locador.nome": "&lt;script&gt;" } as never);
  assert.ok(out.includes("&lt;script&gt;"));
  assert.ok(!out.includes("<script>"));
});

test("CRLF do Windows não deixa parágrafos vazios", () => {
  const out = toDocumentHtml("Linha 1.\r\n\r\nLinha 2.");
  assert.ok(out.includes("<p>Linha 1.</p>"));
  assert.ok(out.includes("<p>Linha 2.</p>"));
  assert.ok(!out.includes("\r"));
});
