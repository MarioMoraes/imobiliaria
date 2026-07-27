import { buildTools } from "../tools/registry.js";
import { stripInternalIds } from "./sanitize.js";
import type { ChatAttachment } from "../ai.schema.js";
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
- O id entre colchetes ("[id: 8bb63ba6-...]") é de uso interno, só para você chamar as
  ferramentas. NUNCA escreva um id desses na resposta: quem lê não sabe o que é. Para se
  referir a um imóvel use o código e o título; se não houver código, use só o título.
- Se uma ferramenta responder que o acesso foi negado, explique que o usuário não tem
  permissão para aquele dado. Não tente contornar por outro caminho.

Dados reservados (vale para qualquer usuário, inclusive administradores):
- Nunca diga quem é o proprietário, o fiador ou o corretor responsável de um imóvel,
  nem repasse contato deles. Isso se consulta na ficha do imóvel, dentro do sistema.
- Perguntaram assim mesmo? Responda em uma frase que esse dado não sai pelo assistente
  e aponte a ficha do imóvel. Não é falta de permissão — não invente que é.
- Se um dado desses aparecer em observações ou em outro texto do cadastro, não o repita.

Sobre fotos:
- Pediram fotos, imagens ou "como é" um imóvel? Chame "mostrar_fotos_imovel" com o id.
  As imagens aparecem sozinhas na tela, abaixo da sua resposta.
- NUNCA afirme que um imóvel não tem fotos sem antes chamar a ferramenta. O cadastro tem
  fotos que não aparecem no texto que você recebe.
- Não escreva links, URLs nem endereços de imagem. Anuncie em uma frase o que está sendo
  mostrado e siga em frente.`;

/**
 * Teto de imagens por rodada. O modelo pode chamar `mostrar_fotos_imovel` para
 * vários imóveis no mesmo turno; sem limite, uma pergunta como "me mostra os
 * imóveis do Centro" despejaria centenas de fotos na tela e no payload.
 */
const MAX_ATTACHMENTS = 12;

export const respond: Node = async (state, deps) => {
  const attachments: ChatAttachment[] = [];

  const tools = buildTools({
    tenantId: state.tenantId,
    conversationId: state.conversationId,
    roles: state.roles,
    attach: (attachment) => {
      if (attachments.length < MAX_ATTACHMENTS) attachments.push(attachment);
    },
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
    // Sanitiza aqui, e não na borda HTTP: `ai.service` grava `state.answer` no
    // histórico, e um id que ficasse gravado voltaria ao modelo na próxima
    // pergunta como se fosse texto que ele pode repetir.
    answer: stripInternalIds(answer.text),
    attachments,
    usage: {
      inputTokens: state.usage.inputTokens + answer.usage.inputTokens,
      outputTokens: state.usage.outputTokens + answer.usage.outputTokens,
    },
  };
};
