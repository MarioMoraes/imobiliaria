/**
 * Documentos brasileiros: formatação "conforme digita" (máscara) e validação de
 * dígitos verificadores para CPF, CNPJ (inclusive o novo CNPJ ALFANUMÉRICO) e
 * máscara de CEP.
 *
 * CNPJ alfanumérico (regra Serpro, vigente a partir de 2026): as 12 primeiras
 * posições podem conter letras (A–Z) ou dígitos (0–9); os 2 últimos dígitos
 * verificadores são SEMPRE numéricos. No cálculo do módulo 11, cada caractere
 * vale `código ASCII − 48` (assim '0'..'9' → 0..9 e 'A'..'Z' → 17..42).
 */

/** Remove tudo que não for alfanumérico e coloca em caixa alta (forma canônica). */
export function normalizeDoc(value: string): string {
  return (value ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** Só dígitos (para CPF/CEP/telefone). */
export function onlyDigits(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

// ── Máscaras (formatar conforme digita) ────────────────────────────────────

/** Aplica a máscara de CPF `000.000.000-00` sobre o que o usuário digitou. */
export function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Aplica a máscara de CNPJ `00.000.000/0000-00`. Aceita letras nas 12 primeiras
 * posições (alfanumérico); as 2 últimas (DV) só aceitam dígitos.
 */
export function formatCnpj(value: string): string {
  const raw = normalizeDoc(value);
  const base = raw.slice(0, 12); // alfanumérico
  const dv = raw.slice(12, 14).replace(/\D/g, ""); // só dígitos
  const chars = base + dv;
  const p = (a: number, b?: number) => chars.slice(a, b);
  if (chars.length <= 2) return p(0);
  if (chars.length <= 5) return `${p(0, 2)}.${p(2)}`;
  if (chars.length <= 8) return `${p(0, 2)}.${p(2, 5)}.${p(5)}`;
  if (chars.length <= 12) return `${p(0, 2)}.${p(2, 5)}.${p(5, 8)}/${p(8)}`;
  return `${p(0, 2)}.${p(2, 5)}.${p(5, 8)}/${p(8, 12)}-${p(12)}`;
}

/** Máscara segundo o tipo de pessoa selecionado (PF → CPF, PJ → CNPJ). */
export function formatCpfCnpj(value: string, personType: "PF" | "PJ"): string {
  return personType === "PJ" ? formatCnpj(value) : formatCpf(value);
}

/** Máscara de CEP `00000-000`. */
export function formatCep(value: string): string {
  const d = onlyDigits(value).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

// ── Validação de dígitos verificadores ─────────────────────────────────────

/** Valida um CPF (11 dígitos, não todos iguais, DV correto). */
export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
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

/** Valor de um caractere do CNPJ no módulo 11: código ASCII − 48. */
function cnpjCharValue(c: string): number {
  return c.charCodeAt(0) - 48;
}

function cnpjCheckDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += cnpjCharValue(base[i]!) * weights[i]!;
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

/**
 * Valida um CNPJ alfanumérico (14 posições: 12 alfanuméricas + 2 dígitos de DV).
 * Também aceita o CNPJ tradicional (100% numérico) como caso particular.
 */
export function isValidCnpj(value: string): boolean {
  const v = normalizeDoc(value);
  if (v.length !== 14) return false;
  if (!/^[0-9A-Z]{12}\d{2}$/.test(v)) return false;
  if (/^(.)\1{13}$/.test(v)) return false; // todos iguais
  const base = v.slice(0, 12);
  const dv1 = cnpjCheckDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = cnpjCheckDigit(base + dv1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === Number(v[12]) && dv2 === Number(v[13]);
}

/** True se o documento (CPF ou CNPJ) for válido, decidindo pelo comprimento. */
export function isValidCpfCnpj(value: string): boolean {
  const v = normalizeDoc(value);
  if (v.length === 11) return isValidCpf(v);
  if (v.length === 14) return isValidCnpj(v);
  return false;
}

/**
 * Mensagem de erro de validação para um documento (ou `null` se válido/vazio).
 * Vazio é considerado válido porque o campo é opcional.
 */
export function validateCpfCnpj(value: string, personType: "PF" | "PJ"): string | null {
  const v = normalizeDoc(value);
  if (v.length === 0) return null;
  if (personType === "PF") {
    if (v.length !== 11) return "CPF deve ter 11 dígitos.";
    return isValidCpf(v) ? null : "CPF inválido.";
  }
  if (v.length !== 14) return "CNPJ deve ter 14 caracteres.";
  return isValidCnpj(v) ? null : "CNPJ inválido.";
}
