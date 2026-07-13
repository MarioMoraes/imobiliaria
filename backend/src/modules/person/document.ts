/**
 * Validação de CPF e CNPJ (incluindo o CNPJ ALFANUMÉRICO — regra Serpro vigente
 * a partir de 2026). Usado no `person.schema` para rejeitar documentos inválidos
 * na fronteira da API (defesa em profundidade — o frontend também valida).
 *
 * No CNPJ, as 12 primeiras posições podem ser letras (A–Z) ou dígitos e os 2
 * últimos (DV) são sempre numéricos. No cálculo do módulo 11 cada caractere vale
 * `código ASCII − 48` ('0'..'9' → 0..9, 'A'..'Z' → 17..42).
 */

/** Forma canônica: só alfanumérico, caixa alta. */
export const normalizeDoc = (v: string): string => v.replace(/[^0-9A-Za-z]/g, "").toUpperCase();

export function isValidCpf(value: string): boolean {
  const d = value.replace(/\D/g, "");
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  const dv = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function cnpjCheckDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += (base.charCodeAt(i) - 48) * weights[i]!;
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

export function isValidCnpj(value: string): boolean {
  const v = normalizeDoc(value);
  if (v.length !== 14) return false;
  if (!/^[0-9A-Z]{12}\d{2}$/.test(v)) return false;
  if (/^(.)\1{13}$/.test(v)) return false;
  const base = v.slice(0, 12);
  const dv1 = cnpjCheckDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = cnpjCheckDigit(base + dv1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === Number(v[12]) && dv2 === Number(v[13]);
}

/** Valida CPF (11) ou CNPJ (14) pela quantidade de caracteres normalizados. */
export function isValidCpfCnpj(value: string): boolean {
  const v = normalizeDoc(value);
  if (v.length === 11) return isValidCpf(v);
  if (v.length === 14) return isValidCnpj(v);
  return false;
}
