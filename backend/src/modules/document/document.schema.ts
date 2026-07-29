import { z } from "zod";

/**
 * MOD-DOC (documental_09) — repositório documental.
 *
 * O binário vive no bucket (mesma infraestrutura das fotos de imóvel); aqui
 * ficam os metadados, a chave do objeto e o histórico de versões.
 *
 * **Desvio deliberado do PRD:** ele lista `entity_type` como
 * PROPERTY/OWNER/CUSTOMER/CONTRACT. Neste repositório locador, locatário e
 * fiador são a MESMA entidade (`persons` com `roles[]`), então há um único
 * `PERSON` — separar aqui criaria uma classificação que o resto do sistema não
 * conhece.
 */

/** A que o documento se prende. */
export const documentEntityType = z.enum(["PROPERTY", "PERSON", "CONTRACT"]);
export type DocumentEntityType = z.infer<typeof documentEntityType>;

/** Natureza do documento (espelha a lista do PRD §4). */
export const documentKind = z.enum([
  "RG",
  "CPF",
  "RENDA",
  "MATRICULA",
  "CONTRATO",
  "OUTRO",
]);
export type DocumentKind = z.infer<typeof documentKind>;

/**
 * Só ATIVO e EXPURGADO são persistidos. "Expirado" não é status: é derivado de
 * `expiresAt` na leitura — ver `DocumentRecord.expired`.
 */
export const documentStatus = z.enum(["ATIVO", "EXPURGADO"]);
export type DocumentStatus = z.infer<typeof documentStatus>;

/**
 * O que aceitamos guardar. PDF e imagem cobrem RG, comprovante de renda e
 * matrícula — que é o que chega na prática, digitalizado ou fotografado.
 */
export const ALLOWED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/**
 * Teto do arquivo. O upload viaja como data URL base64 dentro do JSON (mesmo
 * caminho das fotos), o que infla ~33%: 5 MB de arquivo ≈ 6,7 MB de corpo, e o
 * `bodyLimit` do Fastify é 8 MB (`app.ts`). Para subir esse teto, os dois
 * números precisam subir juntos.
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DATA_URL_CHARS = Math.ceil(MAX_FILE_BYTES * 1.4);

const dataUrl = z
  .string()
  .max(MAX_DATA_URL_CHARS, "Arquivo acima do limite de 5 MB")
  .regex(
    /^data:(application\/pdf|image\/(png|jpe?g|webp));base64,/,
    "Formato não aceito (use PDF, PNG, JPG ou WEBP)",
  );

const fileName = z.string().trim().min(1).max(200);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (AAAA-MM-DD)");

export const createDocumentSchema = z.object({
  entityType: documentEntityType,
  entityId: z.string().uuid(),
  kind: documentKind.default("OUTRO"),
  fileName,
  dataUrl,
  expiresAt: isoDate.optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

/** Nova versão: o vínculo e a natureza não mudam, o arquivo sim. */
export const addVersionSchema = z.object({
  fileName: fileName.optional(),
  dataUrl,
  /** Omitir mantém a validade atual; `null` limpa (documento sem validade). */
  expiresAt: isoDate.nullable().optional(),
});
export type AddVersionInput = z.infer<typeof addVersionSchema>;

/** Filtros da biblioteca. Sem nenhum, devolve tudo o que está ATIVO. */
export const listDocumentsQuery = z.object({
  entityType: documentEntityType.optional(),
  entityId: z.string().uuid().optional(),
  kind: documentKind.optional(),
  /** `true` inclui os expurgados (que só existem para auditoria). */
  includePurged: z.coerce.boolean().optional(),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuery>;

/** Documento como está no banco — `storageKey` nunca sai daqui. */
export interface StoredDocument {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  kind: string;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  status: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  /** Chave da versão vigente; nula depois do expurgo. */
  storageKey: string | null;
}

/** Documento exposto ao cliente: URL presignada temporária, sem chave. */
export interface DocumentRecord {
  id: string;
  entityType: string;
  entityId: string;
  kind: string;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  status: string;
  currentVersion: number;
  /** Derivado de `expiresAt` na leitura — nenhuma rotina precisa ter rodado. */
  expired: boolean;
  /** Presignada e curta; nula quando o binário já foi expurgado. */
  url: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  version: number;
  mime: string | null;
  sizeBytes: number | null;
  uploadedBy: string | null;
  uploadedAt: string;
}
