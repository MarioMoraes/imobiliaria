import assert from "node:assert/strict";
import { test } from "node:test";
import { integerToWords, moneyToWords } from "./extenso.js";

/** Puro (sem infra): valor por extenso dos contratos. */

test("escreve os inteiros de cada faixa", () => {
  assert.equal(integerToWords(0), "zero");
  assert.equal(integerToWords(1), "um");
  assert.equal(integerToWords(15), "quinze");
  assert.equal(integerToWords(21), "vinte e um");
  assert.equal(integerToWords(100), "cem", "cem sozinho não vira 'cento'");
  assert.equal(integerToWords(101), "cento e um");
  assert.equal(integerToWords(999), "novecentos e noventa e nove");
});

test("mil não leva 'um' na frente", () => {
  assert.equal(integerToWords(1_000), "mil");
  assert.equal(integerToWords(2_000), "dois mil");
  assert.equal(integerToWords(1_500), "mil e quinhentos");
});

test("a conjunção do último grupo segue a norma", () => {
  // "e" quando o último grupo é menor que cem ou centena redonda; vírgula nos demais.
  assert.equal(integerToWords(1_100), "mil e cem");
  assert.equal(integerToWords(1_020), "mil e vinte");
  assert.equal(integerToWords(1_234), "mil, duzentos e trinta e quatro");
  assert.equal(
    integerToWords(1_234_567),
    "um milhão, duzentos e trinta e quatro mil, quinhentos e sessenta e sete",
  );
});

test("grupos zerados no meio somem", () => {
  assert.equal(integerToWords(1_000_500), "um milhão e quinhentos");
  assert.equal(integerToWords(2_000_000), "dois milhões");
  assert.equal(integerToWords(1_000_000_000), "um bilhão");
});

test("converte centavos em reais por extenso", () => {
  assert.equal(moneyToWords(0), "zero reais");
  assert.equal(moneyToWords(100), "um real");
  assert.equal(moneyToWords(250_000), "dois mil e quinhentos reais");
  assert.equal(moneyToWords(45_000), "quatrocentos e cinquenta reais");
  assert.equal(moneyToWords(38_000_000), "trezentos e oitenta mil reais");
});

test("os centavos entram depois do 'e'", () => {
  assert.equal(moneyToWords(1), "um centavo");
  assert.equal(moneyToWords(50), "cinquenta centavos");
  assert.equal(moneyToWords(150), "um real e cinquenta centavos");
  assert.equal(moneyToWords(123_456), "mil, duzentos e trinta e quatro reais e cinquenta e seis centavos");
});

test("milhão exato leva a preposição, quebrado não", () => {
  assert.equal(moneyToWords(200_000_000), "dois milhões de reais");
  assert.equal(moneyToWords(150_000_000), "um milhão e quinhentos mil reais");
});

test("valor fora da faixa suportada falha alto em vez de escrever errado", () => {
  assert.throws(() => integerToWords(-1), RangeError);
  assert.throws(() => integerToWords(1e15), RangeError);
});
