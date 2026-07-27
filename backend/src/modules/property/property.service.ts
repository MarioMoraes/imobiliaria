import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { deleteObject, presignGetUrl, putObject } from "../../shared/storage.js";
import * as repo from "./property.repository.js";
import * as personService from "../person/person.service.js";
import type {
  AddPhotoInput,
  CreatePropertyInput,
  Property,
  PropertyOwner,
  PropertyPhoto,
  StoredPhoto,
  UpdatePropertyInput,
} from "./property.schema.js";

/**
 * Regras de negócio de imóveis. O service é a fronteira do módulo:
 * routes chamam o service, nunca o repository direto.
 */

/** Busca livre (barra global). Ver `searchProperties` no repositório. */
export function search(tenantId: string, term: string, limit?: number): Promise<Property[]> {
  return repo.searchProperties(tenantId, term, limit);
}

export function list(tenantId: string): Promise<Property[]> {
  return repo.listProperties(tenantId);
}

/**
 * Varredura paginada do inventário disponível. Interface pública para quem
 * precisa percorrer TODOS os imóveis (o indexador do RAG, em MOD-AI) — `list`
 * corta em 100 porque serve a uma tela.
 *
 * `after` é o cursor: passe o último item da página anterior, ou null para
 * começar. Devolve menos que `limit` quando acabou.
 */
export function listForIndex(
  tenantId: string,
  after: { createdAt: string; id: string } | null,
  limit = 200,
): Promise<Property[]> {
  return repo.listAvailableForIndex(tenantId, after, limit);
}

/** Imóveis vinculados a um condomínio (tela "Consulta Condôminos"). */
export function listByCondominium(
  tenantId: string,
  condominiumId: string,
): Promise<Property[]> {
  return repo.listByCondominium(tenantId, condominiumId);
}

export async function getById(tenantId: string, id: string): Promise<Property> {
  const property = await repo.findProperty(tenantId, id);
  if (!property) throw AppError.notFound("Imóvel não encontrado");
  return property;
}

export async function create(
  tenantId: string,
  input: CreatePropertyInput,
): Promise<Property> {
  const property = await repo.insertProperty(tenantId, input);

  // Evento de domínio consumido por publishing/ai-orchestrator/portal (SPEC 12).
  await publish({
    type: "property.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { propertyId: property.id },
  });

  return property;
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdatePropertyInput,
): Promise<Property> {
  const updated = await repo.updateProperty(tenantId, id, input);
  if (!updated) throw AppError.notFound("Imóvel não encontrado");

  await publish({
    type: "property.updated",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { propertyId: id },
  });

  return updated;
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deleteProperty(tenantId, id);
  if (!removed) throw AppError.notFound("Imóvel não encontrado");
}

/** Donos (proprietários) de um imóvel. */
export async function listOwners(tenantId: string, propertyId: string): Promise<PropertyOwner[]> {
  const property = await repo.findProperty(tenantId, propertyId);
  if (!property) throw AppError.notFound("Imóvel não encontrado");
  return property.owners;
}

/**
 * Vincula um dono (pessoa) ao imóvel. Valida que a pessoa existe no tenant via
 * o service público de MOD-PESSOA (nunca acessa o repository de outro módulo).
 */
export async function addOwner(
  tenantId: string,
  propertyId: string,
  personId: string,
  sharePercent: number,
): Promise<Property> {
  const property = await repo.findProperty(tenantId, propertyId);
  if (!property) throw AppError.notFound("Imóvel não encontrado");
  await personService.getById(tenantId, personId); // 404 ERR_PESSOA_001 se não existir

  const updated = await repo.addOwner(tenantId, propertyId, personId, sharePercent);
  await publish({
    type: "property.owner_linked",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { propertyId, personId, sharePercent },
  });
  return updated;
}

export async function removeOwner(
  tenantId: string,
  propertyId: string,
  personId: string,
): Promise<Property> {
  const property = await repo.findProperty(tenantId, propertyId);
  if (!property) throw AppError.notFound("Imóvel não encontrado");
  return repo.removeOwner(tenantId, propertyId, personId);
}

/* ------------------------------------------------------------ Fotos */

/** Data URL base64 → { buffer, contentType, ext }. */
function decodeDataUrl(dataUrl: string): { buffer: Buffer; contentType: string; ext: string } {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw AppError.badRequest("Imagem inválida");
  const contentType = m[1]!;
  const buffer = Buffer.from(m[2]!, "base64");
  const ext = contentType.split("/")[1]!.replace("jpeg", "jpg").replace("+xml", "");
  return { buffer, contentType, ext };
}

/** Transforma o registro do banco na foto exposta (URL presignada temporária). */
async function toPublicPhoto(photo: StoredPhoto): Promise<PropertyPhoto> {
  return {
    id: photo.id,
    propertyId: photo.propertyId,
    url: await presignGetUrl(photo.storageKey),
    caption: photo.caption,
    position: photo.position,
    createdAt: photo.createdAt,
  };
}

export async function listPhotos(tenantId: string, propertyId: string): Promise<PropertyPhoto[]> {
  await getById(tenantId, propertyId); // 404 se o imóvel não existir
  const stored = await repo.listPhotos(tenantId, propertyId);
  return Promise.all(stored.map(toPublicPhoto));
}

/**
 * Quantas fotos cada imóvel tem, em lote. Existe para quem precisa saber SE há
 * fotos sem pagar o preço de presignar cada uma (`listPhotos` faz uma chamada
 * ao storage por foto). É o que o RAG e as ferramentas do copiloto usam.
 */
export function countPhotos(
  tenantId: string,
  propertyIds: readonly string[],
): Promise<Map<string, number>> {
  return repo.countPhotos(tenantId, propertyIds);
}

export async function addPhoto(
  tenantId: string,
  propertyId: string,
  input: AddPhotoInput,
): Promise<PropertyPhoto> {
  await getById(tenantId, propertyId);

  const { buffer, contentType, ext } = decodeDataUrl(input.dataUrl);
  const storageKey = `${tenantId}/properties/${propertyId}/${randomUUID()}.${ext}`;
  await putObject(storageKey, buffer, contentType);

  const photo = await repo.insertPhoto(tenantId, propertyId, {
    storageKey,
    contentType,
    sizeBytes: buffer.length,
    caption: input.caption ?? null,
  });

  await publish({
    type: "property.photo_added",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { propertyId, photoId: photo.id },
  });
  return toPublicPhoto(photo);
}

export async function removePhoto(
  tenantId: string,
  propertyId: string,
  photoId: string,
): Promise<void> {
  const storageKey = await repo.deletePhoto(tenantId, propertyId, photoId);
  if (!storageKey) throw AppError.notFound("Foto não encontrada");
  // Remove o objeto do bucket (best-effort: a linha já saiu do banco).
  try {
    await deleteObject(storageKey);
  } catch {
    /* órfão no bucket é tolerável; um GC pode limpar depois */
  }

  // Par do `property.photo_added`: o documento indexado no RAG diz quantas
  // fotos o imóvel tem, então apagar a última precisa reindexar — senão o
  // copiloto continua oferecendo fotos que não existem mais.
  await publish({
    type: "property.photo_removed",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { propertyId, photoId },
  });
}
