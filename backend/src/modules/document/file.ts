import { AppError } from "../../shared/errors.js";
import { ALLOWED_MIME, MAX_FILE_BYTES } from "./document.schema.js";

/**
 * Regras puras do arquivo recebido — sem banco, sem bucket, sem HTTP. Ficam
 * separadas porque são o que mais vale testar sozinho (mesmo motivo de
 * `receivable/rent-schedule.ts`).
 */

export interface DecodedFile {
  buffer: Buffer;
  mime: string;
  ext: string;
}

/**
 * Data URL base64 → binário. Mesmo caminho das fotos de imóvel: o arquivo viaja
 * no JSON, sem multipart. O zod já barrou o formato na borda; aqui validamos o
 * que só se sabe depois de decodificar — o tamanho real.
 */
export function decodeDataUrl(dataUrl: string): DecodedFile {
  const m = /^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw AppError.badRequest("Arquivo inválido");

  const mime = m[1]!;
  if (!(ALLOWED_MIME as readonly string[]).includes(mime)) {
    throw AppError.badRequest("Formato não aceito (use PDF, PNG, JPG ou WEBP)");
  }

  const buffer = Buffer.from(m[2]!, "base64");
  if (buffer.length === 0) throw AppError.badRequest("Arquivo vazio");
  if (buffer.length > MAX_FILE_BYTES) {
    throw AppError.badRequest("Arquivo acima do limite de 5 MB");
  }

  const ext =
    mime === "application/pdf" ? "pdf" : mime.split("/")[1]!.replace("jpeg", "jpg");
  return { buffer, mime, ext };
}

/**
 * "Expirado" é derivado, nunca gravado: sem agendador no backend, um status
 * persistido ficaria mentindo até alguém rodar uma rotina. Comparação em texto
 * ISO (AAAA-MM-DD) — ordem lexicográfica é a cronológica, e sem fuso no meio.
 */
export function isExpired(expiresAt: string | null, today: string): boolean {
  return !!expiresAt && expiresAt < today;
}

/** Hoje em AAAA-MM-DD (o mesmo formato que o Postgres devolve para `date`). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
