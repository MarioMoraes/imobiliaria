import { env } from "../../../config/env.js";
import { AppError } from "../../../shared/errors.js";
import { logger } from "../../../shared/logger.js";
import type { EmbeddingClient } from "./types.js";

/**
 * Cliente de embeddings (Voyage AI).
 *
 * A Anthropic não expõe API de embeddings — a Voyage é a parceira recomendada.
 * Não há SDK Node oficial, então é `fetch` direto, no mesmo estilo de
 * `shared/mailer.ts`. Injetável pelo mesmo motivo do `LlmClient`: sem isso o
 * teste do RAG precisaria de rede.
 *
 * A dimensão do vetor é contrato de banco (`rag_chunks.embedding vector(1024)`),
 * não detalhe do cliente: trocar VOYAGE_MODEL por um de outra dimensão faz o
 * INSERT falhar — que é o comportamento certo, melhor que gravar lixo.
 */

interface VoyageResponse {
  data?: { embedding: number[]; index: number }[];
  detail?: string;
}

export function voyageClient(): EmbeddingClient {
  return {
    isConfigured: () => Boolean(env.VOYAGE_API_KEY),

    async embed(texts, inputType) {
      if (texts.length === 0) return [];
      if (!env.VOYAGE_API_KEY) {
        throw new AppError(
          "ERR_AI_005",
          503,
          "Busca semântica indisponível: a plataforma não está com a integração de embeddings configurada.",
        );
      }

      let res: Response;
      try {
        res = await fetch(`${env.VOYAGE_API_URL}/embeddings`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: env.VOYAGE_MODEL,
            input: texts,
            input_type: inputType,
          }),
        });
      } catch (err) {
        logger.warn({ err }, "falha ao contatar a Voyage");
        throw new AppError(
          "INTERNAL",
          502,
          "Não foi possível contatar o serviço de busca semântica. Tente novamente.",
        );
      }

      if (res.status === 401 || res.status === 403) {
        logger.error({ status: res.status }, "credencial da Voyage recusada");
        throw new AppError(
          "ERR_AI_005",
          503,
          "Busca semântica indisponível: credencial da plataforma inválida.",
        );
      }

      const body = (await res.json().catch(() => ({}))) as VoyageResponse;
      if (!res.ok) {
        logger.warn({ status: res.status, detail: body.detail }, "Voyage respondeu com erro");
        throw new AppError("INTERNAL", 502, "O serviço de busca semântica recusou a operação.");
      }

      // A resposta pode vir fora de ordem; `index` é quem diz a qual texto cada
      // vetor pertence. Confiar na ordem do array associaria o embedding errado
      // ao chunk errado — um bug silencioso que só apareceria como "a busca
      // devolve o imóvel trocado".
      const embeddings = new Array<number[]>(texts.length);
      for (const item of body.data ?? []) {
        embeddings[item.index] = item.embedding;
      }
      if (embeddings.some((e) => !e)) {
        throw new AppError("INTERNAL", 502, "O serviço de busca semântica devolveu uma resposta incompleta.");
      }
      return embeddings;
    },
  };
}
