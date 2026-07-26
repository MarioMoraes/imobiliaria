import { logger } from "../../../shared/logger.js";
import type { Node } from "./state.js";

/**
 * Nó 1 — rotula intenção e sentimento da pergunta.
 *
 * Roda no modelo rápido com saída estruturada: é tarefa de etiqueta, não de
 * raciocínio, e gastar o orquestrador nisso dobraria o custo de cada pergunta.
 *
 * Falha aqui NÃO interrompe a conversa. O rótulo alimenta a regra de handoff e
 * a decisão de buscar no índice; nenhuma das duas justifica negar uma resposta
 * ao usuário. Sem rótulo, o padrão é seguir o caminho completo.
 */

const SYSTEM = `Você classifica mensagens enviadas por funcionários de uma imobiliária ao assistente interno.
Responda apenas com o JSON pedido.

intent:
- "imovel": pergunta sobre imóveis do cadastro (busca, características, valores, disponibilidade)
- "pessoa": pergunta sobre proprietários, inquilinos, fiadores ou compradores
- "outro": qualquer outro assunto, incluindo conversa fiada e dúvidas sobre o sistema

sentiment: POS (satisfeito), NEU (neutro), NEG (irritado ou frustrado)`;

const SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["imovel", "pessoa", "outro"] },
    sentiment: { type: "string", enum: ["POS", "NEU", "NEG"] },
  },
  required: ["intent", "sentiment"],
  additionalProperties: false,
} as const;

interface Classification {
  intent: string;
  sentiment: "POS" | "NEU" | "NEG";
}

export const classifyIntent: Node = async (state, deps) => {
  try {
    const result = await deps.llm.classify<Classification>({
      system: SYSTEM,
      input: state.question,
      schema: SCHEMA as unknown as Record<string, unknown>,
    });
    return { ...state, intent: result.intent, sentiment: result.sentiment };
  } catch (err) {
    logger.warn({ err }, "classificação de intenção falhou (seguindo sem rótulo)");
    return state;
  }
};
