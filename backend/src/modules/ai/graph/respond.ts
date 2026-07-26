import { buildTools } from "../tools/registry.js";
import type { Node } from "./state.js";

/**
 * Nó 3 — produz a resposta. É onde o orquestrador roda, com as ferramentas e o
 * contexto que os nós anteriores prepararam.
 */

/**
 * Prompt de sistema. Fica constante de propósito: é o que permite marcá-lo como
 * cacheável no provedor (ver anthropic.client.ts) e cortar a maior parte do
 * custo de entrada a partir da segunda pergunta. Qualquer interpolação aqui —
 * data, nome do usuário, id do tenant — invalidaria o cache a cada requisição.
 */
const SYSTEM = `Você é o copiloto interno de uma imobiliária, falando com um funcionário da equipe.

Como responder:
- Responda em português do Brasil, em prosa curta. Use listas simples quando forem vários imóveis.
- Não use Markdown: a interface mostra texto puro. Nada de **negrito**, # títulos ou tabelas.
- Vá direto ao ponto. Quem pergunta conhece o negócio; não explique o óbvio nem repita a pergunta.

Sobre os dados:
- Responda SOMENTE com base no contexto fornecido e no resultado das ferramentas.
- Nunca invente imóvel, valor, endereço ou pessoa. Se o dado não veio, diga que não encontrou.
- Antes de afirmar valor ou disponibilidade de um imóvel específico, confirme com "detalhar_imovel" —
  o contexto recuperado pode estar desatualizado.
- Cite o código do imóvel quando existir, para a pessoa localizá-lo no sistema.
- Se uma ferramenta responder que o acesso foi negado, explique que o usuário não tem
  permissão para aquele dado. Não tente contornar por outro caminho.`;

export const respond: Node = async (state, deps) => {
  const tools = buildTools({
    tenantId: state.tenantId,
    conversationId: state.conversationId,
    roles: state.roles,
  });

  // O contexto do RAG entra como turno de usuário, antes da pergunta, e não
  // dentro do system: o system é a parte cacheada e estável, o contexto muda a
  // cada pergunta. Misturar os dois destruiria o cache.
  const messages = [...state.history];
  if (state.retrieved.length > 0) {
    messages.push({
      role: "user",
      content: [
        "Contexto recuperado do cadastro de imóveis (pode estar desatualizado):",
        ...state.retrieved.map((c) => `- [id: ${c.entityId}] ${c.content}`),
      ].join("\n"),
    });
    // O turno do assistente fecha o par: a API alterna user/assistant, e sem
    // isso a pergunta real viria colada no contexto como se fosse uma coisa só.
    messages.push({ role: "assistant", content: "Certo, considerei esse contexto." });
  }
  messages.push({ role: "user", content: state.question });

  const answer = await deps.llm.converse({ system: SYSTEM, messages, tools });

  return {
    ...state,
    answer: answer.text,
    usage: {
      inputTokens: state.usage.inputTokens + answer.usage.inputTokens,
      outputTokens: state.usage.outputTokens + answer.usage.outputTokens,
    },
  };
};
