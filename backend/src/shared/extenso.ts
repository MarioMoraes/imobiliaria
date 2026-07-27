/**
 * Valor monetário por extenso (pt-BR) — usado nos contratos, onde a praxe é
 * escrever o número e repeti-lo em palavras ("R$ 2.500,00 (dois mil e
 * quinhentos reais)"). Puro, sem dependência: entra centavos, sai texto.
 */

const UNITS = [
  "", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
  "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete",
  "dezoito", "dezenove",
];

const TENS = [
  "", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta",
  "oitenta", "noventa",
];

const HUNDREDS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
  "seiscentos", "setecentos", "oitocentos", "novecentos",
];

/** Escala de cada grupo de 3 dígitos, do menos para o mais significativo. */
const SCALES: readonly [singular: string, plural: string][] = [
  ["", ""],
  ["mil", "mil"],
  ["milhão", "milhões"],
  ["bilhão", "bilhões"],
];

/** Maior valor suportado: 999 bilhões (em centavos) — acima disso não há escala. */
const MAX_UNITS = 1_000_000_000_000 - 1;

/** 0–99. */
function tensToWords(n: number): string {
  if (n < 20) return UNITS[n]!;
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? TENS[t]! : `${TENS[t]} e ${UNITS[u]}`;
}

/** 0–999. */
function groupToWords(n: number): string {
  if (n === 100) return "cem"; // "cento" só existe acompanhado (cento e um)
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(HUNDREDS[h]!);
  if (rest > 0) parts.push(tensToWords(rest));
  return parts.join(" e ");
}

/**
 * Inteiro por extenso ("mil duzentos e trinta e quatro").
 *
 * A conjunção segue a norma: o último grupo entra com "e" quando é menor que
 * cem ou é centena redonda (mil **e** cem); nos demais casos, vírgula
 * (um milhão, duzentos e trinta e quatro mil, quinhentos e sessenta e sete).
 */
export function integerToWords(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > MAX_UNITS) {
    throw new RangeError(`valor fora da faixa suportada por extenso: ${value}`);
  }
  const n = Math.trunc(value);
  if (n === 0) return "zero";

  // Grupos de 3 dígitos, do mais significativo para o menos.
  const groups: number[] = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 1000)) {
    groups.unshift(rest % 1000);
  }

  const chunks: string[] = [];
  let lastGroup = 0;
  groups.forEach((group, i) => {
    if (group === 0) return;
    const scaleIndex = groups.length - 1 - i;
    const [singular, plural] = SCALES[scaleIndex]!;
    // "um mil" não se diz; "mil" basta.
    const words = scaleIndex === 1 && group === 1 ? "" : groupToWords(group);
    chunks.push([words, group === 1 ? singular : plural].filter(Boolean).join(" "));
    lastGroup = group;
  });

  // O critério é o último grupo ESCRITO — grupos zerados não contam
  // ("um milhão e quinhentos mil", não "um milhão, quinhentos mil").
  const useAnd = lastGroup < 100 || lastGroup % 100 === 0;
  if (chunks.length === 1) return chunks[0]!;
  const head = chunks.slice(0, -1).join(", ");
  return `${head}${useAnd ? " e " : ", "}${chunks[chunks.length - 1]}`;
}

/** Índice da menor escala usada — decide o "de" de "dois milhões **de** reais". */
function lowestScale(units: number): number {
  let scale = 0;
  for (let rest = units; rest > 0; rest = Math.floor(rest / 1000)) {
    if (rest % 1000 !== 0) return scale;
    scale += 1;
  }
  return scale;
}

/**
 * Centavos → valor por extenso: `250000` → "dois mil e quinhentos reais".
 *
 * Milhões e bilhões exatos levam a preposição ("dois milhões de reais"), como
 * se escreve em contrato; valores quebrados dispensam ("um milhão e quinhentos
 * mil reais").
 */
export function moneyToWords(cents: number): string {
  const total = Math.trunc(cents);
  const units = Math.floor(total / 100);
  const fraction = total % 100;

  const parts: string[] = [];
  if (units > 0) {
    const noun = units === 1 ? "real" : "reais";
    const de = lowestScale(units) >= 2 ? "de " : "";
    parts.push(`${integerToWords(units)} ${de}${noun}`);
  }
  if (fraction > 0) {
    parts.push(`${integerToWords(fraction)} ${fraction === 1 ? "centavo" : "centavos"}`);
  }
  if (parts.length === 0) return "zero reais";
  return parts.join(" e ");
}
