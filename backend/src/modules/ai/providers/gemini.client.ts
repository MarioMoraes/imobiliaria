import { ApiError, GoogleGenAI, type Content, type Part } from "@google/genai";
import { env } from "../../../config/env.js";
import { AppError } from "../../../shared/errors.js";
import { logger } from "../../../shared/logger.js";
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingClient,
  type LlmClient,
  type LlmUsage,
} from "./types.js";

/**
 * Provedor alternativo: Google Gemini.
 *
 * Existe para DESENVOLVIMENTO — o free tier permite exercitar o copiloto ponta
 * a ponta (ferramentas, RAG, créditos) sem conta paga. A Anthropic segue sendo
 * o provedor de produção; qual dos dois roda é decidido por `AI_PROVIDER`.
 *
 * Implementa as mesmas interfaces de `types.ts`, então nada acima disto muda:
 * o grafo, as ferramentas e o serviço não sabem qual provedor está atendendo.
 *
 * Duas diferenças de fundo em relação ao cliente da Anthropic:
 *  - o SDK do Gemini não traz um "tool runner", então o laço de ferramentas é
 *    escrito aqui (é o mesmo laço, ~30 linhas);
 *  - não há cache de prompt explícito, então o prompt de sistema é reenviado
 *    inteiro a cada volta. Para teste é irrelevante; em produção seria caro.
 */

const MAX_TOOL_TURNS = 8;

let sdk: GoogleGenAI | null = null;

function client(): GoogleGenAI {
  if (!env.GEMINI_API_KEY) {
    throw new AppError(
      "ERR_AI_005",
      503,
      "Assistente de IA indisponível: GEMINI_API_KEY não configurada.",
    );
  }
  sdk ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return sdk;
}

/**
 * Mesma política do cliente da Anthropic: o detalhe do provedor vai inteiro
 * para o log, e quem perguntou recebe uma mensagem que descreve o estado do
 * sistema — nunca o corpo bruto da API.
 */
function toAppError(err: unknown, context: string): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ApiError) {
    const detail = err.message;
    if (err.status === 401 || err.status === 403) {
      logger.error({ detail, context }, "credencial do Gemini recusada");
      return new AppError(
        "ERR_AI_005",
        503,
        "Assistente de IA indisponível: credencial da plataforma inválida.",
      );
    }
    if (err.status === 429) {
      // O free tier tem cota por minuto e por dia; estourar é esperado em teste.
      logger.warn({ detail, context }, "cota do Gemini excedida");
      return new AppError(
        "TOO_MANY_REQUESTS",
        429,
        "Cota do assistente de IA excedida. Aguarde um minuto e tente de novo.",
      );
    }
    logger.error({ detail, status: err.status, context }, "Gemini respondeu com erro");
    return new AppError("INTERNAL", 502, `O assistente de IA falhou (${context}).`, { detail });
  }

  const detail = err instanceof Error ? err.message : String(err);
  logger.error({ detail, context, err }, "falha inesperada no Gemini");
  return new AppError("INTERNAL", 502, `O assistente de IA falhou (${context}).`, { detail });
}

export function geminiLlmClient(): LlmClient {
  return {
    isConfigured: () => Boolean(env.GEMINI_API_KEY),

    async converse({ system, messages, tools, maxTokens = 8192 }) {
      const ai = client();
      const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };

      // O Gemini chama o papel do assistente de "model".
      const contents: Content[] = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      // `parametersJsonSchema` aceita JSON Schema cru — o mesmo objeto que as
      // ferramentas já declaram, sem tradução. (O campo `parameters`, mais
      // antigo, usa um dialeto próprio derivado do OpenAPI.)
      const functionDeclarations = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.inputSchema,
      }));

      try {
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
          const response = await ai.models.generateContent({
            model: env.GEMINI_MODEL,
            contents,
            config: {
              systemInstruction: system,
              maxOutputTokens: maxTokens,
              tools: [{ functionDeclarations }],
            },
          });

          // Somamos o consumo de TODAS as voltas: é o que os créditos debitam.
          usage.inputTokens += response.usageMetadata?.promptTokenCount ?? 0;
          usage.outputTokens += response.usageMetadata?.candidatesTokenCount ?? 0;

          const calls = response.functionCalls ?? [];
          if (calls.length === 0) {
            return { text: (response.text ?? "").trim(), usage };
          }

          // O turno do modelo precisa voltar ao histórico EXATAMENTE como veio,
          // senão a próxima chamada não casa a resposta com o pedido.
          const modelParts = response.candidates?.[0]?.content?.parts;
          contents.push({
            role: "model",
            parts: modelParts ?? calls.map((call) => ({ functionCall: call })),
          });

          const resultParts: Part[] = [];
          for (const call of calls) {
            const tool = tools.find((t) => t.name === call.name);
            const output = tool
              ? await tool.run((call.args ?? {}) as Record<string, unknown>)
              : `Ferramenta desconhecida: ${call.name}`;
            resultParts.push({
              functionResponse: {
                id: call.id,
                name: call.name,
                // A chave "output" é o que o Gemini espera para o retorno útil.
                response: { output },
              },
            });
          }
          contents.push({ role: "user", parts: resultParts });
        }

        // Chegar aqui significa que o modelo ficou pedindo ferramenta sem
        // concluir. Melhor devolver isso do que girar para sempre.
        logger.warn({ turns: MAX_TOOL_TURNS }, "laço de ferramentas do Gemini não convergiu");
        return {
          text: "Não consegui concluir a consulta — tente reformular a pergunta.",
          usage,
        };
      } catch (err) {
        throw toAppError(err, "resposta");
      }
    },

    async classify<T>({
      system,
      input,
      schema,
    }: {
      system: string;
      input: string;
      schema: Record<string, unknown>;
    }): Promise<T> {
      const ai = client();
      try {
        const response = await ai.models.generateContent({
          model: env.GEMINI_FAST_MODEL,
          contents: [{ role: "user", parts: [{ text: input }] }],
          config: {
            systemInstruction: system,
            maxOutputTokens: 512,
            responseMimeType: "application/json",
            responseJsonSchema: schema,
          },
        });
        return JSON.parse(response.text ?? "{}") as T;
      } catch (err) {
        throw toAppError(err, "classificação");
      }
    },
  };
}

export function geminiEmbeddingClient(): EmbeddingClient {
  return {
    isConfigured: () => Boolean(env.GEMINI_API_KEY),

    async embed(texts, inputType) {
      if (texts.length === 0) return [];
      const ai = client();

      try {
        const response = await ai.models.embedContent({
          model: env.GEMINI_EMBEDDING_MODEL,
          contents: texts,
          config: {
            // É isto que mantém o schema intacto: o Gemini entrega 3072
            // dimensões por padrão, mas aceita truncar (Matryoshka) para
            // qualquer valor entre 128 e 3072 — pedimos exatamente as 1024 de
            // `rag_chunks.embedding`. Sem isso, trocar de provedor exigiria
            // recriar a tabela.
            outputDimensionality: EMBEDDING_DIMENSIONS,
            // Documento e consulta vivem em espaços levemente diferentes;
            // usar o mesmo tipo para os dois piora o recall.
            taskType: inputType === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          },
        });

        const embeddings = response.embeddings ?? [];
        if (embeddings.length !== texts.length) {
          throw new AppError(
            "INTERNAL",
            502,
            "O serviço de busca semântica devolveu uma resposta incompleta.",
          );
        }
        return embeddings.map((item, i) => {
          const values = item.values;
          if (!values || values.length !== EMBEDDING_DIMENSIONS) {
            throw new AppError(
              "INTERNAL",
              502,
              `Embedding com dimensão inesperada (${values?.length ?? 0} em vez de ${EMBEDDING_DIMENSIONS}); o índice espera ${EMBEDDING_DIMENSIONS}.`,
              { index: i },
            );
          }
          return values;
        });
      } catch (err) {
        throw toAppError(err, "embeddings");
      }
    },
  };
}
