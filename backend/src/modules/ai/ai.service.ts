import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { logger } from "../../shared/logger.js";
import * as aiRepo from "./ai.repository.js";
import * as credits from "./credits.repository.js";
import { runGraph } from "./graph/run.js";
import { initialState } from "./graph/state.js";
import type { AgentDeps } from "./graph/state.js";
import { embeddingClient, llmClient } from "./providers/index.js";
import { indexProperty, reindexTenant, type ReindexResult } from "./rag/indexer.js";
import type {
  ChatAnswer,
  Conversation,
  ConversationDetail,
  Credits,
} from "./ai.schema.js";

/**
 * Regra de negócio do MOD-AI. Orquestra: créditos → grafo → persistência →
 * eventos. As rotas chamam daqui; nunca o repositório direto.
 *
 * Os provedores chegam por parâmetro (`deps`) com um padrão vindo do ambiente.
 * Sem esse ponto de injeção não haveria como testar o grafo: a suíte sobe
 * Postgres de verdade mas nunca chama API externa.
 */

function defaultDeps(): AgentDeps {
  return { llm: llmClient(), embeddings: embeddingClient() };
}

/**
 * Estimativa da reserva, em créditos.
 *
 * Deliberadamente grosseira e generosa: o objetivo da reserva é impedir que
 * duas perguntas simultâneas furem o saldo, não prever o custo. O acerto vem no
 * `commit`, com o consumo real do provedor. `question.length / 4` é a
 * aproximação usual de tokens por caractere; o prompt de sistema e as
 * ferramentas somam alguns milhares fixos.
 */
function estimateCredits(question: string): number {
  const promptTokens = 3000 + Math.ceil(question.length / 4);
  const maxOutputTokens = 16000;
  return credits.tokensToCredits(promptTokens) + credits.tokensToCredits(maxOutputTokens);
}

/**
 * Uma rodada do copiloto.
 *
 * A ordem importa: reserva ANTES de chamar o provedor (senão o gate de saldo
 * não gateia nada) e estorna no `catch` (senão uma falha de rede cobraria uma
 * resposta que nunca existiu).
 */
export async function chat(
  tenantId: string,
  input: { conversationId?: string; message: string; userId?: string; roles: readonly string[] },
  deps: AgentDeps = defaultDeps(),
): Promise<ChatAnswer> {
  if (!deps.llm.isConfigured()) {
    throw new AppError(
      "ERR_AI_005",
      503,
      "Assistente de IA indisponível: a plataforma não está com a integração configurada.",
    );
  }

  const conversation = input.conversationId
    ? await requireConversation(tenantId, input.conversationId)
    : await aiRepo.createConversation(tenantId, { userId: input.userId, channel: "WEB" });

  const reserved = estimateCredits(input.message);
  const ok = await credits.reserve(tenantId, reserved);
  if (!ok) {
    throw new AppError(
      "ERR_AI_006",
      402,
      "Créditos de IA insuficientes. Recarregue para continuar usando o assistente.",
    );
  }

  // A pergunta é gravada antes da resposta: se o provedor cair, a conversa
  // mostra o que foi perguntado em vez de um buraco.
  await aiRepo.insertMessage(tenantId, conversation.id, {
    role: "user",
    content: input.message,
  });
  await aiRepo.setTitleIfEmpty(tenantId, conversation.id, input.message);

  let state;
  try {
    // O histórico é lido DEPOIS de gravar a pergunta e exclui a última mensagem
    // — a pergunta atual entra no prompt pelo nó `respond`, não pelo histórico,
    // e duplicá-la faria o modelo ver a mesma frase duas vezes.
    const history = (await aiRepo.listMessages(tenantId, conversation.id))
      .filter((m) => m.role !== "system")
      .slice(0, -1)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    state = await runGraph(
      initialState({
        tenantId,
        conversationId: conversation.id,
        roles: input.roles,
        question: input.message,
        history,
        unresolvedAttempts: conversation.unresolvedAttempts,
      }),
      deps,
    );
  } catch (err) {
    await credits.refund(tenantId, reserved);
    throw err;
  }

  const totalTokens = state.usage.inputTokens + state.usage.outputTokens;
  const used = credits.tokensToCredits(totalTokens);
  await credits.commit(tenantId, reserved, used);

  const answer = state.answer?.trim() || "Não consegui responder a essa pergunta.";
  await aiRepo.insertMessage(tenantId, conversation.id, {
    role: "assistant",
    content: answer,
    tokens: totalTokens,
  });
  await aiRepo.updateSignals(tenantId, conversation.id, {
    sentiment: state.sentiment,
    unresolvedAttempts: state.unresolvedAttempts,
  });

  await publish({
    type: "ai.answered",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      conversationId: conversation.id,
      credits: used,
      needsHandoff: state.needsHandoff,
    },
  });

  return { conversationId: conversation.id, answer, creditsUsed: used };
}

async function requireConversation(tenantId: string, id: string): Promise<Conversation> {
  const conversation = await aiRepo.findConversation(tenantId, id);
  if (!conversation) throw new AppError("ERR_AI_001", 404, "Conversa não encontrada");
  return conversation;
}

export function listConversations(tenantId: string): Promise<Conversation[]> {
  return aiRepo.listConversations(tenantId);
}

export async function getConversation(
  tenantId: string,
  id: string,
): Promise<ConversationDetail> {
  const detail = await aiRepo.findConversationDetail(tenantId, id);
  if (!detail) throw new AppError("ERR_AI_001", 404, "Conversa não encontrada");
  return detail;
}

export function getCredits(tenantId: string): Promise<Credits> {
  return credits.getCredits(tenantId);
}

/** Backfill do índice (rota `ai:admin`). */
export async function reindex(
  tenantId: string,
  entityId: string | undefined,
  deps: AgentDeps = defaultDeps(),
): Promise<ReindexResult> {
  if (!deps.embeddings.isConfigured()) {
    throw new AppError(
      "ERR_AI_005",
      503,
      "Indexação indisponível: a plataforma não está com a integração de embeddings configurada.",
    );
  }

  if (entityId) {
    const outcome = await indexProperty(tenantId, entityId, deps.embeddings);
    return {
      scanned: 1,
      indexed: outcome === "indexed" ? 1 : 0,
      skipped: outcome === "skipped" ? 1 : 0,
    };
  }
  return reindexTenant(tenantId, deps.embeddings);
}

/**
 * Reindexa um imóvel a partir de um evento de domínio. Usado pelo consumidor
 * (rag/consumer.ts) — tolerante a falha porque um erro aqui não pode derrubar o
 * processamento da fila.
 */
export async function reindexProperty(tenantId: string, propertyId: string): Promise<void> {
  const embeddings = embeddingClient();
  if (!embeddings.isConfigured()) return;
  try {
    const outcome = await indexProperty(tenantId, propertyId, embeddings);
    logger.debug({ tenantId, propertyId, outcome }, "imóvel reindexado no RAG");
  } catch (err) {
    logger.warn({ err, tenantId, propertyId }, "falha ao reindexar imóvel no RAG");
  }
}
