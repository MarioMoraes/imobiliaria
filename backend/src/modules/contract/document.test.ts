import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendWitnessBlock,
  hasWitnessPlaceholder,
  isHtmlDocument,
  toDocumentHtml,
} from "./document.js";
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

test("modelo em HTML não busca recurso externo (o Gotenberg renderiza na rede interna)", () => {
  const malicioso = [
    "<!doctype html><html><body>",
    '<img src="http://169.254.169.254/latest/meta-data/iam/">',
    '<iframe src="http://imobiliaria-postgres:5432"></iframe>',
    '<link rel="stylesheet" href="https://exfil.example/x.css">',
    '<div style="background: url(http://exfil.example/beacon.png)">x</div>',
    "</body></html>",
  ].join("");

  const out = toDocumentHtml(malicioso);

  assert.ok(!out.includes("169.254.169.254"), "metadata da nuvem não pode sobrar");
  assert.ok(!out.includes("imobiliaria-postgres"), "serviço interno não pode sobrar");
  assert.ok(!out.includes("exfil.example"), "nenhum host externo pode sobrar");
  assert.ok(!/<iframe/i.test(out), "iframe é removido");
  assert.ok(!/<link/i.test(out), "link é removido");
  assert.ok(out.includes("Contrato") === false && out.includes("<body>"), "o documento segue HTML");
});

test("modelo em HTML preserva imagem embutida e âncora interna", () => {
  const ok =
    '<!doctype html><html><body><img src="data:image/png;base64,AAAA">' +
    '<a href="#clausula-3">Cláusula 3</a></body></html>';

  const out = toDocumentHtml(ok);

  assert.ok(out.includes("data:image/png;base64,AAAA"), "data URL é conteúdo do próprio modelo");
  assert.ok(out.includes('href="#clausula-3"'), "âncora interna não busca nada");
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

test("**negrito** e _itálico_ viram ênfase no documento", () => {
  const out = toDocumentHtml("A multa é de **10%** do valor _vigente_.");
  assert.ok(out.includes("<strong>10%</strong>"));
  assert.ok(out.includes("<em>vigente</em>"));
});

test("marcador solto ou atravessando linhas não vira ênfase", () => {
  const out = toDocumentHtml("Item 2 ** destaque\nna linha seguinte ** fim");
  assert.ok(!out.includes("<strong>"), "o par não pode atravessar a quebra de linha");
  // Sublinhado no meio de uma palavra (nome de variável, e-mail) fica intacto.
  assert.ok(toDocumentHtml("campo_de_teste").includes("campo_de_teste"));
});

test("o bloco das testemunhas entra dentro do corpo do documento", () => {
  const doc = toDocumentHtml("Modelo que termina em\n\nTestemunhas:");
  const out = appendWitnessBlock(doc, "Ana Souza", "Carlos Lima");
  assert.ok(out.includes("Ana Souza") && out.includes("Carlos Lima"));
  assert.ok(out.endsWith("</body></html>"), "o bloco não pode sair depois do </body>");
});

test("o nome da testemunha é escapado (é texto digitado na hora)", () => {
  const out = appendWitnessBlock("<body></body>", "<script>alert(1)</script>", "x");
  assert.ok(!out.includes("<script>"));
  assert.ok(out.includes("&lt;script&gt;"));
});

test("modelo que já usa {{testemunha}} manda no posicionamento", () => {
  assert.ok(hasWitnessPlaceholder("Testemunhas: {{ testemunha1.nome }} e {{testemunha2.nome}}"));
  assert.ok(!hasWitnessPlaceholder("E por estarem de acordo, assinam com duas testemunhas."));
});

test("dado do cadastro com ** NÃO formata o documento", () => {
  // A ênfase é aplicada na conversão; a variável só é trocada depois, na
  // geração. Um nome com asteriscos sai literal.
  const html = toDocumentHtml("LOCADOR: {{locador.nome}}");
  const out = render(html, { "locador.nome": "**Fulano**" } as never);
  assert.ok(out.includes("**Fulano**"));
  assert.ok(!out.includes("<strong>"));
});
