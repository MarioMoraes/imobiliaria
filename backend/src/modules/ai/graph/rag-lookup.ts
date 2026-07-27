import { can } from "../../rbac/permissions.js";
import { logger } from "../../../shared/logger.js";
import * as propertyService from "../../property/property.service.js";
import * as ragRepo from "../rag/rag.repository.js";
import type { RetrievedChunk } from "../rag/rag.repository.js";
import type { Node } from "./state.js";

/** Acima disto o chunk é ruído: o cosseno já está longe demais para ajudar. */
const MAX_DISTANCE = 0.6;
const TOP_K = 6;

/**
 * Nó 2 — recupera do índice vetorial os trechos parecidos com a pergunta.
 *
 * O contexto recuperado é injetado no prompt SEM passar por ferramenta, então o
 * gate de RBAC precisa acontecer aqui: quem não tem `property:read` não recebe
 * descrição de imóvel de brinde. É a mesma regra do registry, aplicada no outro
 * caminho pelo qual dado de domínio chega ao modelo.
 */
export const ragLookup: Node = async (state, deps) => {
  // Hoje o índice só tem imóveis. Quem não pode lê-los não recebe contexto —
  // o modelo então trabalha só com as ferramentas que lhe restarem.
  if (!can(state.roles, "property:read")) return state;

  // Pergunta que o classificador marcou como "outro" ("bom dia", "o que você
  // faz?") não tem o que buscar; embeddar isso seria pagar por ruído.
  if (state.intent === "outro") return state;

  try {
    const [embedding] = await deps.embeddings.embed([state.question], "query");
    const chunks = await ragRepo.searchSimilar(state.tenantId, embedding!, TOP_K);
    const perto = chunks.filter((c) => c.distance <= MAX_DISTANCE);
    return { ...state, retrieved: await semOrfaos(state.tenantId, perto) };
  } catch (err) {
    // Índice indisponível degrada para "só ferramentas", que ainda responde
    // bem — melhor que falhar a pergunta inteira.
    logger.warn({ err }, "busca no índice do RAG falhou (seguindo sem contexto)");
    return state;
  }
};

/**
 * Descarta chunk de imóvel que não existe mais.
 *
 * O índice é uma CÓPIA do cadastro, mantida por evento, e cópia atrasa: se o
 * `property.deleted` se perder (fila fora do ar), o trecho fica no índice para
 * sempre — não virá outro evento daquele imóvel para corrigi-lo. O modelo então
 * descreve com convicção um imóvel que sumiu, que foi exatamente o que
 * aconteceu com imóveis de teste apagados sem que o índice soubesse.
 *
 * Uma consulta por pergunta, para o lote todo (TOP_K = 6).
 */
async function semOrfaos(
  tenantId: string,
  chunks: RetrievedChunk[],
): Promise<RetrievedChunk[]> {
  const ids = chunks.filter((c) => c.entityType === "property").map((c) => c.entityId);
  if (ids.length === 0) return chunks;

  const vivos = await propertyService.existingIds(tenantId, ids);
  const validos = chunks.filter((c) => c.entityType !== "property" || vivos.has(c.entityId));

  if (validos.length !== chunks.length) {
    logger.warn(
      { tenantId, descartados: chunks.length - validos.length },
      "chunks de imóvel inexistente descartados do contexto — índice do RAG desatualizado",
    );
  }
  return validos;
}
