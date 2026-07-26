import type {
  EmbeddingClient,
  LlmClient,
  LlmMessage,
  LlmUsage,
} from "../providers/types.js";
import type { RetrievedChunk } from "../rag/rag.repository.js";
import type { Sentiment } from "../ai.schema.js";

/**
 * Estado que atravessa o grafo do agente (PRD MOD-AI §6).
 *
 * O SPEC prescreve LangGraph; aqui o grafo é próprio, em TypeScript. O motivo
 * está registrado em modules/README.md — em resumo: são cinco nós
 * determinísticos, e nós tipados próprios mantêm o estado no nosso Postgres e
 * respeitam `withTenant`/RLS sem invólucro, sem trazer uma dependência pesada
 * para orquestrar um `if`.
 *
 * O estado é um objeto único que cada nó recebe e devolve enriquecido. Nada de
 * mutação escondida: `run.ts` encadeia os retornos.
 */

export interface AgentDeps {
  llm: LlmClient;
  embeddings: EmbeddingClient;
}

export interface AgentState {
  tenantId: string;
  conversationId: string;
  /** Papéis de quem perguntou — o que limita as ferramentas. */
  roles: readonly string[];
  /** Pergunta atual. */
  question: string;
  /** Histórico anterior (sem a pergunta atual). */
  history: LlmMessage[];

  /** Preenchido por classify-intent. */
  intent?: string;
  sentiment?: Sentiment;

  /** Preenchido por rag-lookup. */
  retrieved: RetrievedChunk[];

  /** Preenchido por respond. */
  answer?: string;
  usage: LlmUsage;

  /** Preenchido por check-handoff. */
  needsHandoff: boolean;
  unresolvedAttempts: number;
}

export function initialState(input: {
  tenantId: string;
  conversationId: string;
  roles: readonly string[];
  question: string;
  history: LlmMessage[];
  unresolvedAttempts: number;
}): AgentState {
  return {
    ...input,
    retrieved: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    needsHandoff: false,
  };
}

/** Um nó do grafo: recebe estado + dependências, devolve o estado adiante. */
export type Node = (state: AgentState, deps: AgentDeps) => Promise<AgentState>;
