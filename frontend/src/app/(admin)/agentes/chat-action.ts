"use server";

import { sendJson } from "../../../lib/api";

/**
 * Uma rodada de conversa com o copiloto. É uma Server Action pelo mesmo motivo
 * da busca global (`search-action.ts`): o cliente HTTP de `lib/api` roda só no
 * servidor — é ele que injeta o token da sessão do Clerk.
 *
 * Sem streaming: Server Actions não transmitem texto incrementalmente, então a
 * resposta chega inteira. Para o volume de uma pergunta sobre inventário isso é
 * questão de segundos, e a alternativa (um route handler com SSE) seria o
 * primeiro `route.ts` do projeto — fica para quando o ganho justificar.
 */
/** Foto que o copiloto anexou à resposta (ver ChatAttachment no backend). */
export interface ChatAttachment {
  kind: "photo";
  url: string;
  caption: string | null;
  source: string;
}

export async function chatAction(input: {
  conversationId?: string;
  message: string;
}): Promise<
  | { ok: true; conversationId: string; answer: string; attachments: ChatAttachment[] }
  | { ok: false; error: string }
> {
  const message = input.message.trim();
  if (!message) return { ok: false, error: "Escreva uma pergunta." };

  const result = await sendJson("POST", "/v1/ai/chat", {
    conversationId: input.conversationId,
    message,
  });

  if (!result.ok) return { ok: false, error: result.error };

  const data = result.data as
    | { conversationId?: string; answer?: string; attachments?: ChatAttachment[] }
    | undefined;
  if (!data?.answer || !data.conversationId) {
    return { ok: false, error: "O assistente não devolveu uma resposta." };
  }
  return {
    ok: true,
    conversationId: data.conversationId,
    answer: data.answer,
    // Backend antigo (ou resposta sem fotos) não manda o campo.
    attachments: data.attachments ?? [],
  };
}
