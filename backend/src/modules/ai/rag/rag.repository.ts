import { withTenant } from "../../../shared/db.js";
import { toVectorLiteral } from "../providers/types.js";

/**
 * Índice vetorial (pgvector). Duas tabelas: `rag_chunks` guarda os pedaços com
 * seus embeddings, `rag_index_meta` guarda o que já foi indexado e com que hash.
 *
 * O isolamento é o de sempre — `withTenant` + RLS. Vale reler a nota do
 * `init.sql` sobre o índice HNSW ser global: o filtro por tenant continua sendo
 * a policy, aplicada sobre as linhas que o índice devolve.
 */

export interface Chunk {
  entityType: string;
  entityId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
}

export interface RetrievedChunk {
  entityType: string;
  entityId: string;
  content: string;
  /** Distância de cosseno: 0 = idêntico, 2 = oposto. Menor é melhor. */
  distance: number;
}

/**
 * Substitui os chunks de uma entidade. Apagar-e-reinserir (em vez de UPDATE)
 * é o que torna a reindexação idempotente: o consumidor de eventos pode
 * processar a mesma mensagem duas vezes sem duplicar nada — por isso o módulo
 * não precisa de tabela de inbox.
 */
export async function replaceChunks(
  tenantId: string,
  entityType: string,
  entityId: string,
  chunks: Chunk[],
  hash: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      "DELETE FROM rag_chunks WHERE entity_type = $1 AND entity_id = $2",
      [entityType, entityId],
    );

    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO rag_chunks (tenant_id, entity_type, entity_id, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tenantId,
          chunk.entityType,
          chunk.entityId,
          chunk.chunkIndex,
          chunk.content,
          toVectorLiteral(chunk.embedding),
        ],
      );
    }

    await client.query(
      `INSERT INTO rag_index_meta (tenant_id, entity_type, entity_id, content_hash, chunk_count, indexed_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (tenant_id, entity_type, entity_id)
       DO UPDATE SET content_hash = EXCLUDED.content_hash,
                     chunk_count  = EXCLUDED.chunk_count,
                     indexed_at   = now()`,
      [tenantId, entityType, entityId, hash, chunks.length],
    );
  });
}

/** Remove a entidade do índice (imóvel excluído ou que saiu de "disponível"). */
export async function removeEntity(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      "DELETE FROM rag_chunks WHERE entity_type = $1 AND entity_id = $2",
      [entityType, entityId],
    );
    await client.query(
      "DELETE FROM rag_index_meta WHERE entity_type = $1 AND entity_id = $2",
      [entityType, entityId],
    );
  });
}

/** Hash da última indexação — quem decide se vale reembeddar. */
export async function getIndexedHash(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ content_hash: string }>(
      "SELECT content_hash FROM rag_index_meta WHERE entity_type = $1 AND entity_id = $2",
      [entityType, entityId],
    );
    return rows[0]?.content_hash ?? null;
  });
}

/**
 * Busca por similaridade. `<=>` é a distância de cosseno do pgvector; o `ORDER
 * BY ... LIMIT` é o que faz o planner usar o índice HNSW.
 */
export async function searchSimilar(
  tenantId: string,
  embedding: number[],
  limit = 6,
): Promise<RetrievedChunk[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      entity_type: string;
      entity_id: string;
      content: string;
      distance: number;
    }>(
      `SELECT entity_type, entity_id, content, embedding <=> $1 AS distance
         FROM rag_chunks
        ORDER BY embedding <=> $1
        LIMIT $2`,
      [toVectorLiteral(embedding), limit],
    );
    return rows.map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      content: r.content,
      distance: Number(r.distance),
    }));
  });
}

export async function countChunks(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM rag_chunks",
    );
    return Number(rows[0]?.count ?? 0);
  });
}
