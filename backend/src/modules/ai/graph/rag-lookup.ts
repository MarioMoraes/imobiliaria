import { can } from "../../rbac/permissions.js";
import { logger } from "../../../shared/logger.js";
import * as ragRepo from "../rag/rag.repository.js";
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
    return { ...state, retrieved: chunks.filter((c) => c.distance <= MAX_DISTANCE) };
  } catch (err) {
    // Índice indisponível degrada para "só ferramentas", que ainda responde
    // bem — melhor que falhar a pergunta inteira.
    logger.warn({ err }, "busca no índice do RAG falhou (seguindo sem contexto)");
    return state;
  }
};
