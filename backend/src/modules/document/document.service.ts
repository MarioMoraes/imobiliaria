import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { deleteObject, presignGetUrl, putObject } from "../../shared/storage.js";
import { getAuthUser } from "../../shared/tenant-context.js";
import * as contractService from "../contract/contract.service.js";
import * as personService from "../person/person.service.js";
import * as propertyService from "../property/property.service.js";
import * as repo from "./document.repository.js";
import { decodeDataUrl, isExpired, todayIso } from "./file.js";
import type {
  AddVersionInput,
  CreateDocumentInput,
  DocumentEntityType,
  DocumentRecord,
  DocumentVersion,
  ListDocumentsQuery,
  StoredDocument,
} from "./document.schema.js";

/**
 * Regras do repositório documental. O service é a fronteira do módulo: routes
 * chamam o service, nunca o repository.
 *
 * A URL de leitura é presignada e curta (RN-01 do PRD: nunca URL pública
 * permanente). 15 minutos é o meio-termo entre os 5 do PRD e a hora que as
 * fotos usam — o suficiente para a lista ficar aberta um tempo sem que o link
 * copiado vire um acesso perpétuo.
 */
const URL_TTL_SECONDS = 15 * 60;

/**
 * Confirma que a entidade existe, chamando o **service público** do módulo dono
 * (nunca o repositório dele). Cada `getById` já lança o 404 com o código de erro
 * do seu domínio, que é a mensagem certa para quem chamou.
 *
 * Direção da dependência: document → property/person/contract. Nenhum dos três
 * depende de document, então não há ciclo a desfazer.
 */
async function assertEntityExists(
  tenantId: string,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<void> {
  if (entityType === "PROPERTY") await propertyService.getById(tenantId, entityId);
  else if (entityType === "PERSON") await personService.getById(tenantId, entityId);
  else await contractService.getById(tenantId, entityId);
}

/* ------------------------------------------------------------- Exposição */

/** `expired` é derivado aqui, não lido: nenhuma rotina precisa ter rodado. */
async function toRecord(doc: StoredDocument): Promise<DocumentRecord> {
  const today = todayIso();
  return {
    id: doc.id,
    entityType: doc.entityType,
    entityId: doc.entityId,
    kind: doc.kind,
    fileName: doc.fileName,
    mime: doc.mime,
    sizeBytes: doc.sizeBytes,
    expiresAt: doc.expiresAt,
    status: doc.status,
    currentVersion: doc.currentVersion,
    expired: doc.status === "ATIVO" && isExpired(doc.expiresAt, today),
    url: doc.storageKey ? await presignGetUrl(doc.storageKey, URL_TTL_SECONDS) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/* ---------------------------------------------------------------- Leitura */

export async function list(
  tenantId: string,
  filters: ListDocumentsQuery,
): Promise<DocumentRecord[]> {
  const docs = await repo.listDocuments(tenantId, filters);
  return Promise.all(docs.map(toRecord));
}

export async function getById(tenantId: string, id: string): Promise<DocumentRecord> {
  const doc = await repo.findDocument(tenantId, id);
  if (!doc) throw AppError.notFound("Documento não encontrado");
  return toRecord(doc);
}

export function listVersions(tenantId: string, id: string): Promise<DocumentVersion[]> {
  return repo.listVersions(tenantId, id);
}

export function counts(
  tenantId: string,
): Promise<{ total: number; expiring30: number; expired: number }> {
  return repo.countsByStatus(tenantId);
}

/* ---------------------------------------------------------------- Escrita */

export async function create(
  tenantId: string,
  input: CreateDocumentInput,
): Promise<DocumentRecord> {
  await assertEntityExists(tenantId, input.entityType, input.entityId);

  const file = decodeDataUrl(input.dataUrl);
  // A chave carrega o id do documento, mas ele só existe depois do INSERT —
  // por isso o uuid do objeto é gerado aqui e a pasta é a da entidade.
  const storageKey =
    `${tenantId}/documents/${input.entityType.toLowerCase()}/${input.entityId}/` +
    `${randomUUID()}.${file.ext}`;
  await putObject(storageKey, file.buffer, file.mime);

  const doc = await repo.insertDocument(tenantId, {
    entityType: input.entityType,
    entityId: input.entityId,
    kind: input.kind,
    fileName: input.fileName,
    mime: file.mime,
    sizeBytes: file.buffer.length,
    expiresAt: input.expiresAt ?? null,
    storageKey,
    uploadedBy: getAuthUser().userId ?? null,
  });

  // Consumido pelo MOD-AI (OCR) quando ele existir — o documento é utilizável
  // antes de qualquer extração (RN-03).
  await publish({
    type: "document.uploaded",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      documentId: doc.id,
      kind: doc.kind,
      entityType: doc.entityType,
      entityId: doc.entityId,
    },
  });

  return toRecord(doc);
}

export async function addVersion(
  tenantId: string,
  id: string,
  input: AddVersionInput,
): Promise<DocumentRecord> {
  const existing = await repo.findDocument(tenantId, id);
  if (!existing) throw AppError.notFound("Documento não encontrado");
  if (existing.status !== "ATIVO") {
    throw AppError.badRequest("Documento expurgado não aceita nova versão");
  }

  const file = decodeDataUrl(input.dataUrl);
  const storageKey =
    `${tenantId}/documents/${existing.entityType.toLowerCase()}/${existing.entityId}/` +
    `${randomUUID()}.${file.ext}`;
  await putObject(storageKey, file.buffer, file.mime);

  const doc = await repo.insertVersion(tenantId, id, {
    fileName: input.fileName ?? null,
    mime: file.mime,
    sizeBytes: file.buffer.length,
    expiresAt: input.expiresAt,
    storageKey,
    uploadedBy: getAuthUser().userId ?? null,
  });
  if (!doc) throw AppError.notFound("Documento não encontrado");

  await publish({
    type: "document.version_added",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { documentId: doc.id, version: doc.currentVersion },
  });

  return toRecord(doc);
}

/**
 * Expurgo (LGPD). Apaga o binário de **todas** as versões e mantém a linha
 * anonimizada — o histórico de que aquele documento existiu é o que permite
 * responder a uma auditoria depois de atender a um pedido de exclusão.
 */
export async function purge(tenantId: string, id: string): Promise<void> {
  const doc = await repo.findDocument(tenantId, id);
  if (!doc) throw AppError.notFound("Documento não encontrado");

  const keys = await repo.listStorageKeys(tenantId, id);
  const purged = await repo.markPurged(tenantId, id);
  if (!purged) throw AppError.badRequest("Documento já expurgado");

  // Best-effort no bucket, como em `removePhoto`: a linha já está marcada, e um
  // objeto órfão é tolerável — o inverso (binário vivo com a linha anonimizada)
  // não seria.
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch {
      /* objeto órfão no bucket; um GC pode limpar depois */
    }
  }

  await publish({
    type: "document.purged",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { documentId: id },
  });
}
