import type { Node } from "./state.js";

/** Tentativas sem resolver antes de transferir para um humano (decisão de produto). */
const MAX_UNRESOLVED = 3;

/**
 * Nó 4 — decide se a conversa deve ir para um atendente humano (MOD-AI-09).
 *
 * Dois gatilhos, ambos vindos do PRD: sentimento negativo, ou três tentativas
 * seguidas sem resolver.
 *
 * NESTA FATIA O RESULTADO NÃO ABRE CHAMADO. O copiloto atende a própria equipe
 * da imobiliária — "transferir para um humano" não quer dizer nada quando quem
 * pergunta É o humano. O nó existe e grava os sinais para que o dia em que
 * MOD-AI-01 (WhatsApp/Instagram) entrar, o estado já esteja sendo mantido e a
 * regra já esteja escrita e testada.
 */
export const checkHandoff: Node = async (state) => {
  // Sem resposta = tentativa gasta. Com resposta, o contador zera: a régua é de
  // frustração seguida, não acumulada pela vida toda da conversa.
  const unresolved = state.answer ? 0 : state.unresolvedAttempts + 1;

  const needsHandoff = state.sentiment === "NEG" || unresolved >= MAX_UNRESOLVED;

  return { ...state, unresolvedAttempts: unresolved, needsHandoff };
};
