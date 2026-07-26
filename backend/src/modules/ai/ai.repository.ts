import { withTenant } from "../../shared/db.js";
import { decrypt, encrypt } from "../../shared/crypto.js";
import type {
  Conversation,
  ConversationDetail,
  Message,
  MessageRole,
  Sentiment,
  ToolCall,
  ToolCallStatus,
} from "./ai.schema.js";

/**
 * Persistência das conversas do agente. Como em todo módulo, tudo passa por
 * `withTenant` — o RLS é quem garante que uma imobiliária não lê a conversa da
 * outra, mesmo que o SQL não filtre por tenant_id explicitamente.
 *
 * O conteúdo é cifrado aqui dentro (AES-256-GCM) e devolvido em claro para
 * cima: nenhum chamador precisa lembrar de cifrar, e o `_enc` no nome da coluna
 * avisa quem for escrever SQL depois que aquilo não é pesquisável.
 */

interface ConversationRow {
  id: string;
  tenant_id: string;
  person_id: string | null;
  user_id: string | null;
  channel: string;
  status: string;
  sentiment: string | null;
  unresolved_attempts: number;
  title: string | null;
  created_at: Date;
  updated_at: Date;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    personId: row.person_id,
    userId: row.user_id,
    channel: row.channel,
    status: row.status as Conversation["status"],
    sentiment: row.sentiment as Sentiment | null,
    unresolvedAttempts: row.unresolved_attempts,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createConversation(
  tenantId: string,
  input: { userId?: string; channel?: string; title?: string },
): Promise<Conversation> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<ConversationRow>(
      `INSERT INTO agent_conversations (tenant_id, user_id, channel, title)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenantId, input.userId ?? null, input.channel ?? "WEB", input.title ?? null],
    );
    return toConversation(rows[0]!);
  });
}

export async function findConversation(
  tenantId: string,
  id: string,
): Promise<Conversation | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<ConversationRow>(
      "SELECT * FROM agent_conversations WHERE id = $1",
      [id],
    );
    return rows[0] ? toConversation(rows[0]) : null;
  });
}

export async function listConversations(
  tenantId: string,
  limit = 50,
): Promise<Conversation[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<ConversationRow>(
      "SELECT * FROM agent_conversations ORDER BY updated_at DESC LIMIT $1",
      [limit],
    );
    return rows.map(toConversation);
  });
}

/**
 * Conversa + histórico + trilha de ferramentas, numa transação só. Três
 * consultas separadas dariam três `withTenant` (três conexões, três
 * transações) para montar uma tela.
 */
export async function findConversationDetail(
  tenantId: string,
  id: string,
): Promise<ConversationDetail | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<ConversationRow>(
      "SELECT * FROM agent_conversations WHERE id = $1",
      [id],
    );
    if (!rows[0]) return null;

    const messages = await client.query<{
      id: string;
      conversation_id: string;
      role: string;
      content_enc: string;
      tokens: number;
      created_at: Date;
    }>(
      "SELECT * FROM agent_messages WHERE conversation_id = $1 ORDER BY created_at",
      [id],
    );

    const toolCalls = await client.query<{
      id: string;
      conversation_id: string;
      tool: string;
      input: unknown;
      output_enc: string | null;
      status: string;
      duration_ms: number | null;
      created_at: Date;
    }>(
      "SELECT * FROM agent_tool_calls WHERE conversation_id = $1 ORDER BY created_at",
      [id],
    );

    return {
      ...toConversation(rows[0]),
      messages: messages.rows.map(
        (m): Message => ({
          id: m.id,
          conversationId: m.conversation_id,
          role: m.role as MessageRole,
          content: decrypt(m.content_enc),
          tokens: m.tokens,
          createdAt: m.created_at.toISOString(),
        }),
      ),
      toolCalls: toolCalls.rows.map(
        (t): ToolCall => ({
          id: t.id,
          conversationId: t.conversation_id,
          tool: t.tool,
          input: t.input,
          output: t.output_enc ? decrypt(t.output_enc) : null,
          status: t.status as ToolCallStatus,
          durationMs: t.duration_ms,
          createdAt: t.created_at.toISOString(),
        }),
      ),
    };
  });
}

/** Histórico em ordem cronológica — é o que remonta o contexto do modelo. */
export async function listMessages(
  tenantId: string,
  conversationId: string,
  limit = 20,
): Promise<Message[]> {
  return withTenant(tenantId, async (client) => {
    // Pega as N MAIS RECENTES (DESC) e reordena em memória: o `LIMIT` precisa
    // cortar o começo da conversa, não o fim. Um `ORDER BY created_at ASC LIMIT
    // 20` devolveria as 20 primeiras mensagens e esconderia justamente o que
    // acabou de ser dito.
    const { rows } = await client.query<{
      id: string;
      conversation_id: string;
      role: string;
      content_enc: string;
      tokens: number;
      created_at: Date;
    }>(
      "SELECT * FROM agent_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2",
      [conversationId, limit],
    );
    return rows
      .reverse()
      .map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        role: m.role as MessageRole,
        content: decrypt(m.content_enc),
        tokens: m.tokens,
        createdAt: m.created_at.toISOString(),
      }));
  });
}

export async function insertMessage(
  tenantId: string,
  conversationId: string,
  input: { role: MessageRole; content: string; tokens?: number },
): Promise<Message> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      conversation_id: string;
      role: string;
      content_enc: string;
      tokens: number;
      created_at: Date;
    }>(
      `INSERT INTO agent_messages (tenant_id, conversation_id, role, content_enc, tokens)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, conversationId, input.role, encrypt(input.content), input.tokens ?? 0],
    );
    // `updated_at` da conversa é o que ordena a lista de conversas; sem isso a
    // conversa em andamento afundaria no histórico.
    await client.query("UPDATE agent_conversations SET updated_at = now() WHERE id = $1", [
      conversationId,
    ]);
    const row = rows[0]!;
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as MessageRole,
      content: decrypt(row.content_enc),
      tokens: row.tokens,
      createdAt: row.created_at.toISOString(),
    };
  });
}

export async function insertToolCall(
  tenantId: string,
  conversationId: string,
  input: {
    tool: string;
    input: unknown;
    output: string | null;
    status: ToolCallStatus;
    durationMs: number;
  },
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO agent_tool_calls (tenant_id, conversation_id, tool, input, output_enc, status, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        conversationId,
        input.tool,
        JSON.stringify(input.input ?? null),
        input.output === null ? null : encrypt(input.output),
        input.status,
        input.durationMs,
      ],
    );
  });
}

/**
 * Atualiza sinais de handoff (MOD-AI-09). Não é usado nesta fatia — o copiloto
 * interno fala com a equipe, que não precisa ser transferida para a equipe —
 * mas o estado é gravado desde já para o canal externo não precisar de migração.
 */
export async function updateSignals(
  tenantId: string,
  conversationId: string,
  input: { sentiment?: Sentiment; unresolvedAttempts?: number },
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE agent_conversations
          SET sentiment = COALESCE($2, sentiment),
              unresolved_attempts = COALESCE($3, unresolved_attempts),
              updated_at = now()
        WHERE id = $1`,
      [conversationId, input.sentiment ?? null, input.unresolvedAttempts ?? null],
    );
  });
}

/** Título derivado da primeira pergunta — só para a lista de conversas ficar legível. */
export async function setTitleIfEmpty(
  tenantId: string,
  conversationId: string,
  title: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      "UPDATE agent_conversations SET title = $2 WHERE id = $1 AND title IS NULL",
      [conversationId, title.slice(0, 120)],
    );
  });
}
