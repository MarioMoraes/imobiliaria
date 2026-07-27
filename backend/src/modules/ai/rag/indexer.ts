import { logger } from "../../../shared/logger.js";
import * as propertyService from "../../property/property.service.js";
import type { EmbeddingClient } from "../providers/types.js";
import { contentHash, renderPropertyDocument } from "./document.js";
import * as ragRepo from "./rag.repository.js";

/**
 * (Re)indexação do inventário para o RAG.
 *
 * A fronteira de módulo é respeitada: lê imóveis pelo `service` público de
 * MOD-IMOVEL (`listForIndex` / `getById`), nunca pelo repositório dele.
 *
 * Um imóvel = um chunk. O documento renderizado tem algumas linhas — quebrar
 * isso em pedaços menores separaria "2 quartos" de "no Centro", que é
 * exatamente a combinação que a pergunta traz. Se um dia entrar descrição longa
 * de portal, aí sim vale fatiar.
 */

const ENTITY_TYPE = "property";
const PAGE_SIZE = 200;

/**
 * Indexa um imóvel. Devolve o que aconteceu — `skipped` quando o texto não
 * mudou (não gasta chamada de embedding) e `removed` quando o imóvel saiu do
 * índice por não estar mais disponível.
 */
export async function indexProperty(
  tenantId: string,
  propertyId: string,
  embeddings: EmbeddingClient,
): Promise<"indexed" | "skipped" | "removed"> {
  let property;
  try {
    property = await propertyService.getById(tenantId, propertyId);
  } catch {
    // Imóvel excluído entre o evento e o consumo: tirar do índice é o certo.
    await ragRepo.removeEntity(tenantId, ENTITY_TYPE, propertyId);
    return "removed";
  }

  // Só o que está disponível entra: o copiloto não deve oferecer um imóvel que
  // já foi alugado. Mudar de `available` para `rented` é justamente um dos
  // eventos que chegam aqui, então este é o ponto que retira do índice.
  if (property.status !== "available") {
    await ragRepo.removeEntity(tenantId, ENTITY_TYPE, propertyId);
    return "removed";
  }

  const photos = await propertyService.countPhotos(tenantId, [propertyId]);
  const text = renderPropertyDocument(property, photos.get(propertyId) ?? 0);
  const hash = contentHash(text);

  const current = await ragRepo.getIndexedHash(tenantId, ENTITY_TYPE, propertyId);
  if (current === hash) return "skipped";

  const [embedding] = await embeddings.embed([text], "document");
  await ragRepo.replaceChunks(
    tenantId,
    ENTITY_TYPE,
    propertyId,
    [{ entityType: ENTITY_TYPE, entityId: propertyId, chunkIndex: 0, content: text, embedding: embedding! }],
    hash,
  );
  return "indexed";
}

export interface ReindexResult {
  scanned: number;
  indexed: number;
  skipped: number;
}

/**
 * Varre o inventário disponível do tenant. Chamado pela rota de backfill
 * (`POST /v1/ai/rag/reindex`) — o dia a dia é mantido pelo consumidor de
 * eventos, que reindexa uma entidade por vez.
 *
 * Embeda em lote (uma chamada por página, não por imóvel): a API de embeddings
 * cobra por token, mas cada requisição tem latência fixa — mil imóveis em mil
 * requisições levaria minutos a mais sem economizar nada.
 */
export async function reindexTenant(
  tenantId: string,
  embeddings: EmbeddingClient,
): Promise<ReindexResult> {
  const result: ReindexResult = { scanned: 0, indexed: 0, skipped: 0 };
  let cursor: { createdAt: string; id: string } | null = null;

  for (;;) {
    const page = await propertyService.listForIndex(tenantId, cursor, PAGE_SIZE);
    if (page.length === 0) break;

    // Uma contagem para a página inteira — ver `countPhotos` no repositório de
    // imóveis: por imóvel seriam 200 queries a mais por página.
    const photos = await propertyService.countPhotos(
      tenantId,
      page.map((p) => p.id),
    );

    const pending: { id: string; text: string; hash: string }[] = [];
    for (const property of page) {
      result.scanned += 1;
      const text = renderPropertyDocument(property, photos.get(property.id) ?? 0);
      const hash = contentHash(text);
      const current = await ragRepo.getIndexedHash(tenantId, ENTITY_TYPE, property.id);
      if (current === hash) {
        result.skipped += 1;
        continue;
      }
      pending.push({ id: property.id, text, hash });
    }

    if (pending.length > 0) {
      const vectors = await embeddings.embed(
        pending.map((p) => p.text),
        "document",
      );
      for (const [i, item] of pending.entries()) {
        await ragRepo.replaceChunks(
          tenantId,
          ENTITY_TYPE,
          item.id,
          [
            {
              entityType: ENTITY_TYPE,
              entityId: item.id,
              chunkIndex: 0,
              content: item.text,
              embedding: vectors[i]!,
            },
          ],
          item.hash,
        );
        result.indexed += 1;
      }
    }

    const last = page[page.length - 1]!;
    cursor = { createdAt: last.createdAt, id: last.id };
    if (page.length < PAGE_SIZE) break;
  }

  logger.info({ tenantId, ...result }, "reindexação do RAG concluída");
  return result;
}
