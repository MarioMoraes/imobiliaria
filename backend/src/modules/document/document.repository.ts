import { withTenant } from "../../shared/db.js";
import type {
  DocumentVersion,
  ListDocumentsQuery,
  StoredDocument,
} from "./document.schema.js";

/**
 * Acesso a dados do repositório documental. Toda operação roda dentro de
 * `withTenant`, então o RLS garante o isolamento mesmo quando o SQL não filtra
 * `tenant_id` explicitamente.
 */

interface Row {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  kind: string;
  file_name: string | null;
  mime: string | null;
  size_bytes: string | null;
  expires_at: string | null;
  status: string;
  current_version: number;
  created_at: string;
  updated_at: string;
  storage_key: string | null;
}

interface VersionRow {
  id: string;
  document_id: string;
  version: number;
  mime: string | null;
  size_bytes: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

/**
 * A chave da versão vigente entra por LATERAL: é sempre a linha de
 * `document_versions` cujo `version` bate com `documents.current_version`.
 */
const SELECT_DOC = `
  SELECT d.id, d.tenant_id, d.entity_type, d.entity_id, d.kind, d.file_name,
         d.mime, d.size_bytes, d.expires_at::text AS expires_at, d.status,
         d.current_version, d.created_at, d.updated_at, v.storage_key
    FROM documents d
    LEFT JOIN document_versions v
      ON v.document_id = d.id AND v.version = d.current_version`;

function toDocument(row: Row): StoredDocument {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    kind: row.kind,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    expiresAt: row.expires_at,
    status: row.status,
    currentVersion: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    storageKey: row.storage_key,
  };
}

function toVersion(row: VersionRow): DocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    version: row.version,
    mime: row.mime,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
  };
}

export function listDocuments(
  tenantId: string,
  filters: ListDocumentsQuery,
): Promise<StoredDocument[]> {
  return withTenant(tenantId, async (client) => {
    const where: string[] = [];
    const params: unknown[] = [];

    if (!filters.includePurged) where.push("d.status = 'ATIVO'");
    if (filters.entityType) {
      params.push(filters.entityType);
      where.push(`d.entity_type = $${params.length}`);
    }
    if (filters.entityId) {
      params.push(filters.entityId);
      where.push(`d.entity_id = $${params.length}`);
    }
    if (filters.kind) {
      params.push(filters.kind);
      where.push(`d.kind = $${params.length}`);
    }

    const { rows } = await client.query<Row>(
      `${SELECT_DOC}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY d.created_at DESC
       LIMIT 500`,
      params,
    );
    return rows.map(toDocument);
  });
}

export function findDocument(
  tenantId: string,
  id: string,
): Promise<StoredDocument | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(`${SELECT_DOC} WHERE d.id = $1`, [id]);
    return rows[0] ? toDocument(rows[0]) : null;
  });
}

export function listVersions(tenantId: string, documentId: string): Promise<DocumentVersion[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<VersionRow>(
      `SELECT id, document_id, version, mime, size_bytes, uploaded_by, uploaded_at
         FROM document_versions WHERE document_id = $1 ORDER BY version DESC`,
      [documentId],
    );
    return rows.map(toVersion);
  });
}

/** Documento + versão 1 na mesma transação: um sem o outro é lixo. */
export function insertDocument(
  tenantId: string,
  input: {
    entityType: string;
    entityId: string;
    kind: string;
    fileName: string;
    mime: string;
    sizeBytes: number;
    expiresAt: string | null;
    storageKey: string;
    uploadedBy: string | null;
  },
): Promise<StoredDocument> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO documents
         (tenant_id, entity_type, entity_id, kind, file_name, mime, size_bytes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        tenantId,
        input.entityType,
        input.entityId,
        input.kind,
        input.fileName,
        input.mime,
        input.sizeBytes,
        input.expiresAt,
      ],
    );
    const id = rows[0]!.id;

    await client.query(
      `INSERT INTO document_versions
         (tenant_id, document_id, version, storage_key, mime, size_bytes, uploaded_by)
       VALUES ($1, $2, 1, $3, $4, $5, $6)`,
      [tenantId, id, input.storageKey, input.mime, input.sizeBytes, input.uploadedBy],
    );

    const { rows: created } = await client.query<Row>(`${SELECT_DOC} WHERE d.id = $1`, [id]);
    return toDocument(created[0]!);
  });
}

/**
 * Nova versão do documento. O número sai de `current_version + 1` lido na mesma
 * transação — dois uploads simultâneos colidem no índice único
 * `(document_id, version)` em vez de sobrescrever um ao outro.
 */
export function insertVersion(
  tenantId: string,
  documentId: string,
  input: {
    fileName: string | null;
    mime: string;
    sizeBytes: number;
    /** `undefined` mantém a validade atual; `null` a remove. */
    expiresAt: string | null | undefined;
    storageKey: string;
    uploadedBy: string | null;
  },
): Promise<StoredDocument | null> {
  return withTenant(tenantId, async (client) => {
    const { rows: current } = await client.query<{ current_version: number }>(
      `SELECT current_version FROM documents
        WHERE id = $1 AND status = 'ATIVO'
        FOR UPDATE`,
      [documentId],
    );
    if (!current[0]) return null;
    const version = current[0].current_version + 1;

    await client.query(
      `INSERT INTO document_versions
         (tenant_id, document_id, version, storage_key, mime, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, documentId, version, input.storageKey, input.mime, input.sizeBytes, input.uploadedBy],
    );

    await client.query(
      `UPDATE documents
          SET current_version = $2,
              file_name  = COALESCE($3, file_name),
              mime       = $4,
              size_bytes = $5,
              expires_at = CASE WHEN $6::boolean THEN $7::date ELSE expires_at END,
              updated_at = now()
        WHERE id = $1`,
      [
        documentId,
        version,
        input.fileName,
        input.mime,
        input.sizeBytes,
        input.expiresAt !== undefined,
        input.expiresAt ?? null,
      ],
    );

    const { rows } = await client.query<Row>(`${SELECT_DOC} WHERE d.id = $1`, [documentId]);
    return rows[0] ? toDocument(rows[0]) : null;
  });
}

/** Chaves de TODAS as versões — o expurgo apaga o histórico inteiro do bucket. */
export function listStorageKeys(tenantId: string, documentId: string): Promise<string[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ storage_key: string | null }>(
      `SELECT storage_key FROM document_versions WHERE document_id = $1`,
      [documentId],
    );
    return rows.map((r) => r.storage_key).filter((k): k is string => !!k);
  });
}

/**
 * Expurgo LGPD: a linha **fica**, anonimizada. O rastro de auditoria (quem
 * anexou o quê, quando) tem de sobreviver à remoção do conteúdo — por isso não
 * é um DELETE.
 */
export function markPurged(tenantId: string, documentId: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE documents
          SET status = 'EXPURGADO', file_name = NULL, mime = NULL,
              size_bytes = NULL, updated_at = now()
        WHERE id = $1 AND status = 'ATIVO'`,
      [documentId],
    );
    if (!rowCount) return false;

    await client.query(
      `UPDATE document_versions SET storage_key = NULL WHERE document_id = $1`,
      [documentId],
    );
    return true;
  });
}

/** Contadores da biblioteca (biblioteca `/documentos`), numa ida só ao banco. */
export function countsByStatus(
  tenantId: string,
): Promise<{ total: number; expiring30: number; expired: number }> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      total: string;
      expiring30: string;
      expired: string;
    }>(
      `SELECT COUNT(*)                                                          AS total,
              COUNT(*) FILTER (WHERE expires_at >= CURRENT_DATE
                                 AND expires_at <  CURRENT_DATE + 30)           AS expiring30,
              COUNT(*) FILTER (WHERE expires_at <  CURRENT_DATE)                AS expired
         FROM documents WHERE status = 'ATIVO'`,
    );
    const row = rows[0]!;
    return {
      total: Number(row.total),
      expiring30: Number(row.expiring30),
      expired: Number(row.expired),
    };
  });
}
