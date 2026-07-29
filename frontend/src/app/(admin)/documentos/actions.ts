"use server";

import { revalidatePath } from "next/cache";
import {
  deleteJson,
  fetchDocuments,
  postJson,
  type DocumentEntityType,
  type DocumentRecord,
} from "../../../lib/api";

/**
 * Server actions do repositório documental (MOD-DOC). Ficam num arquivo só
 * porque o mesmo painel é usado em três telas — ficha da pessoa, cadastro do
 * imóvel e a biblioteca — e duplicá-las por tela seria três verdades para a
 * mesma operação.
 */

export interface DocumentActionResult {
  ok: boolean;
  error?: string;
}

export interface ListDocumentsResult {
  ok: boolean;
  documents: DocumentRecord[];
  error?: string;
}

export async function listDocumentsAction(
  entityType: DocumentEntityType,
  entityId: string,
): Promise<ListDocumentsResult> {
  if (!entityId) return { ok: false, documents: [], error: "ID inválido." };
  const documents = await fetchDocuments({ entityType, entityId });
  if (documents === null) {
    return { ok: false, documents: [], error: "Não foi possível carregar os documentos." };
  }
  return { ok: true, documents };
}

export async function uploadDocumentAction(input: {
  entityType: DocumentEntityType;
  entityId: string;
  kind: string;
  fileName: string;
  dataUrl: string;
  expiresAt?: string;
}): Promise<DocumentActionResult> {
  if (!input.entityId) return { ok: false, error: "ID inválido." };
  const res = await postJson("/v1/documents", {
    entityType: input.entityType,
    entityId: input.entityId,
    kind: input.kind,
    fileName: input.fileName,
    dataUrl: input.dataUrl,
    expiresAt: input.expiresAt || undefined,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/documentos");
  return { ok: true };
}

/** Substitui o arquivo mantendo o histórico: a versão anterior continua lá. */
export async function addDocumentVersionAction(
  documentId: string,
  input: { fileName: string; dataUrl: string; expiresAt?: string },
): Promise<DocumentActionResult> {
  if (!documentId) return { ok: false, error: "ID inválido." };
  const res = await postJson(`/v1/documents/${documentId}/versions`, {
    fileName: input.fileName,
    dataUrl: input.dataUrl,
    expiresAt: input.expiresAt || undefined,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/documentos");
  return { ok: true };
}

/**
 * Expurgo LGPD: apaga o binário de todas as versões. O registro fica,
 * anonimizado, fora da listagem — não há como desfazer.
 */
export async function purgeDocumentAction(
  documentId: string,
): Promise<DocumentActionResult> {
  if (!documentId) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/documents/${documentId}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/documentos");
  return { ok: true };
}
