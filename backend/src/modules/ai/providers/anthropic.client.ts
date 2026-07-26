import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../../config/env.js";
import { AppError } from "../../../shared/errors.js";
import { logger } from "../../../shared/logger.js";
import type { LlmClient, LlmUsage } from "./types.js";

/**
 * Cliente do modelo de linguagem (Anthropic).
 *
 * É uma INTERFACE, não uma classe concreta, por um motivo prático: a suíte do
 * repositório sobe Postgres de verdade mas nunca chama API externa. Sem um ponto
 * de injeção, testar o grafo exigiria rede — e um teste que depende de rede não
 * roda no CI. `LlmClient` é o que o grafo recebe; `anthropicClient()` é a
 * implementação padrão, e o teste passa um duplo.
 *
 * Diferente de Asaas/ZapSign, a conta é da PLATAFORMA (ver config/env.ts): a
 * imobiliária consome créditos, não traz a própria chave.
 */

let sdk: Anthropic | null = null;

function client(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError(
      "ERR_AI_005",
      503,
      "Assistente de IA indisponível: a plataforma não está com a integração configurada.",
    );
  }
  sdk ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return sdk;
}

/**
 * Normaliza os modos de falha do provedor, no mesmo espírito do `request<T>` de
 * `payment/asaas.client.ts`: erro de rede vira 502 legível, credencial recusada
 * vira 401, e o corpo bruto do provedor nunca chega ao cliente.
 */
function toAppError(err: unknown, context: string): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    logger.error({ err }, "credencial da Anthropic recusada");
    return new AppError(
      "ERR_AI_005",
      503,
      "Assistente de IA indisponível: credencial da plataforma inválida.",
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AppError(
      "TOO_MANY_REQUESTS",
      429,
      "O assistente está sobrecarregado no momento. Tente de novo em alguns segundos.",
    );
  }

  // Um 400 do provedor é SEMPRE problema do nosso lado: ou a conta da
  // plataforma (sem saldo, plano recusado), ou a requisição que montamos. Não
  // é culpa de quem perguntou, e a pessoa na imobiliária não tem o que fazer a
  // respeito — por isso vira 503 "indisponível", e não um 4xx que a faria
  // revisar a própria pergunta.
  //
  // O detalhe do provedor vai INTEIRO para o log em nível error: a primeira
  // versão disto devolvia só "o assistente falhou", e uma mensagem tão precisa
  // quanto "your credit balance is too low" era descartada — quem foi
  // diagnosticar teve que reproduzir a chamada fora do backend para lê-la.
  if (err instanceof Anthropic.BadRequestError) {
    const detail = providerMessage(err);
    logger.error({ detail, context, err }, "Anthropic recusou a requisição (400)");
    return new AppError(
      "ERR_AI_005",
      503,
      "Assistente de IA indisponível: a conta da plataforma foi recusada pelo provedor. Verifique o log do servidor.",
      { detail },
    );
  }
  if (err instanceof Anthropic.APIConnectionError) {
    logger.warn({ err, context }, "falha ao contatar a Anthropic");
    return new AppError(
      "INTERNAL",
      502,
      `Não foi possível contatar o assistente de IA (${context}). Verifique a conexão e tente novamente.`,
    );
  }
  // Qualquer outra coisa (5xx do provedor, erro inesperado do SDK). O detalhe
  // vai para o log em nível error pelo mesmo motivo do 400 acima.
  const detail = providerMessage(err);
  logger.error({ detail, context, err }, "Anthropic respondeu com erro");
  return new AppError("INTERNAL", 502, `O assistente de IA falhou (${context}).`, { detail });
}

/**
 * Extrai a frase que o provedor escreveu, que costuma ser específica o
 * bastante para resolver o problema sozinha ("credit balance is too low",
 * "model not found"). O SDK expõe isso em `err.error.error.message`; o
 * `err.message` traz o JSON inteiro prefixado pelo status, ilegível num log.
 */
function providerMessage(err: unknown): string {
  const body = (err as { error?: { error?: { message?: unknown } } })?.error?.error;
  if (typeof body?.message === "string") return body.message;
  return err instanceof Error ? err.message : String(err);
}

export function anthropicClient(): LlmClient {
  return {
    isConfigured: () => Boolean(env.ANTHROPIC_API_KEY),

    async converse({ system, messages, tools, maxTokens = 16000 }) {
      const anthropic = client();
      const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };

      try {
        // O tool runner do SDK cuida do laço pedir-ferramenta → executar →
        // devolver. As ferramentas são declaradas com JSON Schema cru (helper
        // `json-schema`, não o de zod) de propósito: o backend já usa zod na
        // borda HTTP, e acoplar a definição das tools à versão do zod que o SDK
        // espera criaria um segundo lugar para brigar de versão.
        const { betaTool } = await import("@anthropic-ai/sdk/helpers/beta/json-schema");

        const runner = anthropic.beta.messages.toolRunner({
          model: env.ANTHROPIC_MODEL,
          max_tokens: maxTokens,
          // O prompt de sistema é estável entre requisições; marcá-lo como
          // cacheável corta a maior parte do custo de entrada a partir da
          // segunda pergunta. O histórico volátil vem DEPOIS deste ponto de
          // corte, senão cada pergunta nova invalidaria o cache.
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          // Este nó busca e sintetiza; não é raciocínio profundo. `medium`
          // equilibra custo e qualidade — subir para "high" é a alavanca se as
          // respostas ficarem rasas.
          output_config: { effort: "medium" },
          tools: tools.map((tool) =>
            betaTool({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              run: (input) => tool.run(input as Record<string, unknown>),
            }),
          ),
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        });

        // Cada iteração é uma volta do laço; somamos o consumo de todas porque é
        // isso que os créditos precisam debitar (não só a última).
        for await (const message of runner) {
          usage.inputTokens += message.usage.input_tokens;
          usage.outputTokens += message.usage.output_tokens;
        }

        const final = await runner.done();
        const text = final.content
          .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim();

        return { text, usage };
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
      const anthropic = client();
      try {
        const response = await anthropic.messages.create({
          // Rotular intenção/sentimento é tarefa de etiqueta: o modelo rápido
          // resolve por uma fração do custo do orquestrador.
          model: env.ANTHROPIC_FAST_MODEL,
          max_tokens: 512,
          system,
          output_config: { format: { type: "json_schema", schema } },
          messages: [{ role: "user", content: input }],
        });
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("");
        return JSON.parse(text) as T;
      } catch (err) {
        throw toAppError(err, "classificação");
      }
    },
  };
}
