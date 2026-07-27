import assert from "node:assert/strict";
import { test } from "node:test";
import { stripInternalIds } from "./sanitize.js";

/**
 * Teste puro — não toca no banco nem em provedor:
 *   node --import tsx --test backend/src/modules/ai/graph/sanitize.test.ts
 *
 * Os casos são os formatos que o modelo de fato produz: o colchete que ele
 * copia das ferramentas, o JSON cru que às vezes escapa, e o UUID solto no meio
 * da frase.
 */

const ID = "8bb63ba6-43fd-4d59-ba94-1eb5cd665856";

test("remove o id no formato das ferramentas, sem deixar buraco na frase", () => {
  assert.equal(
    stripInternalIds(`O imóvel [id: ${ID}] está disponível.`),
    "O imóvel está disponível.",
  );
  assert.equal(stripInternalIds(`Apartamento no Centro (id: ${ID}).`), "Apartamento no Centro.");
});

test("remove o id colado como JSON", () => {
  assert.equal(
    stripInternalIds(`Encontrei o imóvel "id":"${ID}" no Centro.`),
    "Encontrei o imóvel no Centro.",
  );
  assert.equal(stripInternalIds(`Imóvel id=${ID} alugado.`), "Imóvel alugado.");
});

test("remove o UUID solto, sem rótulo nenhum", () => {
  assert.equal(stripInternalIds(`Casa ${ID} tem 3 quartos.`), "Casa tem 3 quartos.");
});

test("não deixa espaço antes da pontuação nem colchete vazio", () => {
  assert.equal(stripInternalIds(`Veja o imóvel ${ID}, no Centro.`), "Veja o imóvel, no Centro.");
  assert.equal(stripInternalIds(`Imóvel [${ID}]`), "Imóvel");
});

test("preserva o resto do texto — inclusive o código do imóvel", () => {
  const texto = `Imóvel 1042: casa no Centro, R$ 2.500,00.\nAceita animais.`;
  assert.equal(stripInternalIds(texto), texto);
});

/**
 * A regressão que este arquivo existe para impedir é o id aparecendo; o inverso
 * — comer texto legítimo — seria pior. Um hexadecimal curto ou uma data não
 * podem casar com o padrão de UUID.
 */
test("não confunde outros números com id", () => {
  assert.equal(stripInternalIds("Contrato de 2026-07-27, valor 1234-5678."),
    "Contrato de 2026-07-27, valor 1234-5678.");
  assert.equal(stripInternalIds("Código 8bb63ba6 do imóvel."), "Código 8bb63ba6 do imóvel.");
});

test("id em várias linhas de uma lista", () => {
  const entrada = `Encontrei 2 imóveis:\n- Casa no Centro [id: ${ID}]\n- Apto na Praia [id: ${ID}]`;
  assert.equal(
    stripInternalIds(entrada),
    "Encontrei 2 imóveis:\n- Casa no Centro\n- Apto na Praia",
  );
});
