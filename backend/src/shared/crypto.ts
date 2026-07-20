import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../config/env.js";

/**
 * Cifra simétrica para segredos em repouso (AES-256-GCM, autenticada).
 *
 * Usada pelos tokens de API de terceiros que o tenant nos confia (ZapSign, e os
 * TODOs de CPF/e-mail do PRD §4/9). GCM é autenticado: adulterar o ciphertext
 * faz o `decrypt` lançar, em vez de devolver lixo silenciosamente.
 *
 * Formato: `v1.<iv-b64>.<tag-b64>.<ciphertext-b64>` — o prefixo de versão deixa
 * a rotação de algoritmo possível sem adivinhar o formato de valores antigos.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // recomendado para GCM
const KEY_BYTES = 32; // AES-256
const VERSION = "v1";

let cachedKey: Buffer | null = null;

/** Chave de 32 bytes a partir de APP_ENCRYPTION_KEY (base64). */
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = Buffer.from(env.APP_ENCRYPTION_KEY, "base64");
  if (raw.length !== KEY_BYTES) {
    throw new Error(
      `APP_ENCRYPTION_KEY deve ter ${KEY_BYTES} bytes em base64 (gere com: openssl rand -base64 32)`,
    );
  }
  cachedKey = raw;
  return raw;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Segredo cifrado em formato inválido");
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(), // lança se a tag não bater (valor adulterado)
  ]).toString("utf8");
}

/**
 * Comparação de segredos em tempo constante. Aceita tamanhos diferentes sem
 * vazar isso pelo tempo de resposta (o hash iguala o comprimento).
 */
export function secretEquals(a: string, b: string): boolean {
  const ha = Buffer.from(a, "utf8");
  const hb = Buffer.from(b, "utf8");
  if (ha.length !== hb.length) {
    // Compara contra si mesmo para gastar o mesmo tempo e devolve false.
    timingSafeEqual(ha, ha);
    return false;
  }
  return timingSafeEqual(ha, hb);
}

/** Segredo aleatório url-safe (webhook secret). */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
