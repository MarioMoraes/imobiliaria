/**
 * Redação do corpo do request antes de virar linha de auditoria.
 *
 * A trilha precisa responder "o que mudou", não virar um segundo banco de dados
 * pessoais nem um depósito de segredos: o corpo de `PUT /v1/payment-settings`
 * carrega a chave da Asaas, o de `POST /v1/properties/:id/photos` carrega
 * megabytes de base64. Aqui, o que é segredo some, o que é identificador
 * pessoal fica mascarado e o que é binário vira um marcador de tamanho.
 *
 * A regra é por NOME de chave (não por conteúdo): é o que continua valendo
 * quando um módulo novo inventar mais um campo `apiKey`.
 */

/** Some por completo — substituído por `"[redigido]"`. */
const SECRET_KEYS = [
  "password",
  "senha",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "authtoken",
  "secret",
  "webhooksecret",
  "integrations",
  "credential",
  "privatekey",
];

/** Binário embutido (data URL / base64) — vira `"[binário N bytes]"`. */
const BINARY_KEYS = ["dataurl", "base64", "content", "photo", "photos", "file", "logourl"];

/** Documento/identificador pessoal — mantém só os últimos dígitos. */
const PARTIAL_KEYS = ["cpf", "cnpj", "cpfcnpj", "rg", "email"];

/** Teto do JSON gravado. Acima disso o payload vira um marcador. */
const MAX_JSON_BYTES = 8 * 1024;

const norm = (key: string): string => key.toLowerCase().replace(/[_-]/g, "");
const matches = (key: string, list: readonly string[]): boolean =>
  list.includes(norm(key));

/** Mantém os 3 últimos caracteres: `***456`. Strings curtas somem inteiras. */
function partial(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 3) return "***";
  return `***${trimmed.slice(-3)}`;
}

function redactValue(key: string, value: unknown, depth: number): unknown {
  if (matches(key, SECRET_KEYS)) return "[redigido]";
  if (matches(key, BINARY_KEYS)) {
    if (typeof value === "string") return `[binário ${value.length} bytes]`;
    if (Array.isArray(value)) return `[${value.length} binário(s)]`;
    if (value === null || value === undefined) return value;
    return "[binário]";
  }
  if (matches(key, PARTIAL_KEYS) && typeof value === "string") return partial(value);
  return walk(value, depth + 1);
}

function walk(value: unknown, depth = 0): unknown {
  // Profundidade máxima: um payload aninhado demais já não ajuda a investigar
  // e é o caminho mais curto para um estouro de pilha com entrada do usuário.
  if (depth > 6) return "[…]";
  if (value === null || typeof value !== "object") {
    // String solta muito longa (ex.: HTML de contrato) não interessa à trilha.
    if (typeof value === "string" && value.length > 512) {
      return `${value.slice(0, 512)}… [+${value.length - 512}]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    // Listas longas: guarda uma amostra, não a coleção inteira.
    const sample = value.slice(0, 20).map((item) => walk(item, depth + 1));
    return value.length > 20 ? [...sample, `… +${value.length - 20}`] : sample;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactValue(key, val, depth);
  }
  return out;
}

/**
 * Devolve o corpo pronto para gravar, ou null quando não há nada útil.
 * Nunca lança: um payload exótico (BigInt, referência circular) vira marcador.
 */
export function redact(body: unknown): unknown {
  if (body === null || body === undefined) return null;
  try {
    const cleaned = walk(body);
    const json = JSON.stringify(cleaned);
    if (json === undefined) return null;
    if (json.length > MAX_JSON_BYTES) {
      return { truncado: true, bytes: json.length };
    }
    return cleaned;
  } catch {
    return { erro: "payload não serializável" };
  }
}
