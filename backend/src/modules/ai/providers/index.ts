import { env } from "../../../config/env.js";
import { anthropicClient } from "./anthropic.client.js";
import { geminiEmbeddingClient, geminiLlmClient } from "./gemini.client.js";
import { voyageClient } from "./voyage.client.js";
import type { EmbeddingClient, LlmClient } from "./types.js";

/**
 * Escolha do provedor de IA, num ponto só.
 *
 * `AI_PROVIDER=anthropic` (padrão) usa Claude + Voyage — é o alvo de produção.
 * `AI_PROVIDER=gemini` usa o Google Gemini para as duas coisas, que tem free
 * tier e serve para exercitar o copiloto em desenvolvimento sem conta paga.
 *
 * A troca é possível porque tudo acima daqui depende só das interfaces de
 * `types.ts`. Se um terceiro provedor entrar, é um arquivo novo e um `case`.
 */

export function llmClient(): LlmClient {
  return env.AI_PROVIDER === "gemini" ? geminiLlmClient() : anthropicClient();
}

export function embeddingClient(): EmbeddingClient {
  return env.AI_PROVIDER === "gemini" ? geminiEmbeddingClient() : voyageClient();
}
