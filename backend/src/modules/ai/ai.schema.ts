import { z } from "zod";

/**
 * Contratos de entrada/saída do MOD-AI. Como nos demais módulos, o zod valida
 * na borda HTTP e os `interface` descrevem o que sai do repositório.
 */

export const aiChatSchema = z.object({
  /** Conversa existente; ausente cria uma nova. */
  conversationId: z.string().uuid().optional(),
  // O teto existe para o custo ser previsível: o texto do usuário entra inteiro
  // no prompt, e sem limite uma colagem de 200 KB viraria uma cobrança enorme.
  message: z.string().trim().min(1, "Escreva uma pergunta").max(4000),
});

export type AiChatInput = z.infer<typeof aiChatSchema>;

export const reindexSchema = z.object({
  /** Reindexa só uma entidade; ausente refaz o inventário inteiro do tenant. */
  entityId: z.string().uuid().optional(),
});

export type ReindexInput = z.infer<typeof reindexSchema>;

export type ConversationStatus = "ATIVA" | "HANDOFF" | "ENCERRADA";
export type Sentiment = "POS" | "NEU" | "NEG";
export type MessageRole = "user" | "assistant" | "system";
export type ToolCallStatus = "OK" | "ERROR" | "DENIED";

export interface Conversation {
  id: string;
  tenantId: string;
  personId: string | null;
  userId: string | null;
  channel: string;
  status: ConversationStatus;
  sentiment: Sentiment | null;
  unresolvedAttempts: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  /** Já decifrado — o repositório é quem cuida da cifra. */
  content: string;
  tokens: number;
  createdAt: string;
}

export interface ToolCall {
  id: string;
  conversationId: string;
  tool: string;
  input: unknown;
  output: string | null;
  status: ToolCallStatus;
  durationMs: number | null;
  createdAt: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
  toolCalls: ToolCall[];
}

export interface Credits {
  balance: number;
  reserved: number;
  used: number;
  /** balance - reserved: o que dá para gastar agora. */
  available: number;
}

/**
 * Recarga de créditos (Super Admin). O teto não é burocracia: `balance` é
 * BIGINT e a leitura faz `Number(...)` — um valor absurdo passaria do inteiro
 * seguro do JavaScript e o saldo começaria a mentir. 100 milhões de créditos
 * são 100 bilhões de tokens, folgado para qualquer pacote real.
 */
export const grantCreditsSchema = z.object({
  amount: z.number().int().positive().max(100_000_000),
});
export type GrantCreditsInput = z.infer<typeof grantCreditsSchema>;

/**
 * Mídia que acompanha a resposta — hoje, fotos de imóvel.
 *
 * Vem num campo estruturado, e não no texto: o modelo teria de reproduzir uma
 * URL presignada de ~500 caracteres sem errar um byte, e o prompt de sistema
 * ainda proíbe Markdown. Aqui a ferramenta coleta a URL e a interface a
 * renderiza; o modelo só anuncia o que está sendo mostrado.
 *
 * As URLs expiram em 1 hora (`presignGetUrl`), então isto é bom para a rodada
 * atual e não é persistido junto da mensagem — recarregar a conversa antiga
 * mostra o texto, não as imagens.
 */
export interface ChatAttachment {
  kind: "photo";
  url: string;
  caption: string | null;
  /** De qual imóvel a foto veio, para a legenda da galeria. */
  source: string;
}

/** Resposta de uma rodada do copiloto. */
export interface ChatAnswer {
  conversationId: string;
  answer: string;
  /** Créditos efetivamente debitados nesta rodada. */
  creditsUsed: number;
  attachments: ChatAttachment[];
}
