import { subscribe } from "../../../shared/events.js";
import { logger } from "../../../shared/logger.js";
import * as aiService from "../ai.service.js";

/**
 * Mantém o índice do RAG em dia (RN-07).
 *
 * `property.created`, `property.updated` e `property.photo_added` já eram
 * publicados pelo módulo de imóveis antes deste módulo existir — este é o
 * primeiro consumidor do projeto, e não foi preciso mudar nada do lado de lá.
 * É o benefício de integrar por contrato de evento em vez de por chamada
 * direta.
 *
 * NÃO precisa de tabela de inbox para idempotência: reindexar é apagar os
 * chunks da entidade e reinserir. Processar o mesmo evento duas vezes dá
 * exatamente o mesmo resultado, e o `content_hash` ainda evita o custo de
 * reembeddar quando o texto não mudou.
 */

const QUEUE = "ai.rag.property";

interface PropertyEventPayload {
  propertyId?: string;
}

export async function startRagConsumer(): Promise<void> {
  await subscribe(QUEUE, ["property.*"], async (event) => {
    const payload = event.payload as PropertyEventPayload;
    if (!payload?.propertyId || !event.tenantId) {
      logger.warn({ type: event.type }, "evento de imóvel sem propertyId/tenantId (ignorado)");
      return;
    }
    // `reindexProperty` já é tolerante a falha por dentro; um imóvel que não
    // indexou não pode travar a fila dos outros.
    await aiService.reindexProperty(event.tenantId, payload.propertyId);
  });
}
