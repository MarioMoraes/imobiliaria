import { can, type Operation } from "../../rbac/permissions.js";
import { logger } from "../../../shared/logger.js";
import type { LlmTool, ToolInputSchema } from "../providers/types.js";
import * as aiRepo from "../ai.repository.js";
import { searchPropertiesTool } from "./search-properties.js";
import { getPropertyTool } from "./get-property.js";
import { listPhotosTool } from "./list-photos.js";
import { searchPersonsTool } from "./search-persons.js";
import type { ChatAttachment } from "../ai.schema.js";

/**
 * Catálogo de ferramentas do agente e o invólucro que as governa.
 *
 * ────────────────────────────────────────────────────────────────
 * A regra que mais importa aqui: a ferramenta roda com a permissão de QUEM
 * PERGUNTOU, não com a do papel `AI_AGENT`.
 *
 * `AI_AGENT` existe em rbac/permissions.ts e tem `property:read` — mas ele é a
 * identidade dos canais externos, onde o cliente final não tem sessão. No
 * copiloto interno quem pergunta *tem* sessão e tem papéis, e o agente não pode
 * enxergar mais do que a pessoa enxergaria navegando pela tela. Um corretor
 * perguntando ao copiloto não pode receber, pela boca do modelo, um dado que a
 * interface esconderia dele.
 *
 * Ferramenta negada NÃO derruba a requisição: devolve um texto de erro ao
 * modelo, que então explica a limitação em português. Estourar um 403 no meio
 * do laço de ferramentas transformaria "não posso ver isso" em "erro interno".
 * ────────────────────────────────────────────────────────────────
 *
 * Toda chamada — autorizada, negada ou com falha — vira uma linha em
 * `agent_tool_calls`. É a trilha que responde "por que o agente disse isso".
 *
 * ────────────────────────────────────────────────────────────────
 * DADOS RESERVADOS — a segunda regra, e ela NÃO é de permissão.
 *
 * Nenhuma ferramenta pode ligar um IMÓVEL às PESSOAS por trás dele:
 * proprietário, fiador ou corretor responsável. Não é uma questão de papel —
 * vale inclusive para ADMIN. Quem precisa desse dado abre a ficha do imóvel na
 * tela, onde o acesso é explícito, deliberado e fica no log da aplicação; uma
 * conversa é fácil de encaminhar por print, e um agente que responde "o dono é
 * o Sr. Fulano, telefone tal" transforma um clique auditável num vazamento
 * casual.
 *
 * Isso é diferente do gate de RBAC acima: `buscar_pessoas` continua existindo e
 * continua liberada por `person:read`. O que se corta é o CAMINHO imóvel →
 * pessoa. Buscar alguém pelo nome é uma coisa; descobrir quem é o dono do 101
 * é outra.
 *
 * Na prática, ao escrever uma ferramenta nova:
 * - não devolva `property.owners` (nem os nomes, nem a contagem);
 * - não devolva o corretor responsável nem partes de contrato a partir do imóvel;
 * - se precisar do vínculo para uma regra interna, use-o e não o coloque no
 *   texto que volta ao modelo — tudo que a ferramenta devolve é dizível.
 * ────────────────────────────────────────────────────────────────
 */

export interface ToolContext {
  tenantId: string;
  conversationId: string;
  /** Papéis de quem fez a pergunta. */
  roles: readonly string[];
  /**
   * Anexa mídia à resposta desta rodada (fotos de imóvel). Existe porque nem
   * tudo que a ferramenta produz cabe no texto que volta ao modelo — ver
   * `list-photos.ts`. Só o nó `respond` sabe o que fazer com o que for
   * coletado; a ferramenta só empurra.
   */
  attach: (attachment: ChatAttachment) => void;
}

/** Ferramenta antes de ganhar contexto: descreve o que faz e o que exige. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** Permissão exigida — avaliada contra os papéis do usuário a cada chamada. */
  requires: Operation;
  execute: (ctx: ToolContext, input: Record<string, unknown>) => Promise<string>;
}

const DEFINITIONS: ToolDefinition[] = [
  searchPropertiesTool,
  getPropertyTool,
  listPhotosTool,
  searchPersonsTool,
];

/**
 * Aplica o gate de RBAC e a auditoria a cada definição, produzindo as
 * ferramentas que o provedor recebe.
 *
 * Note que as ferramentas sem permissão continuam sendo DECLARADAS ao modelo.
 * É deliberado: escondê-las faria o modelo responder "não tenho como consultar
 * isso", quando a resposta útil é "você não tem acesso a essa informação" —
 * são coisas diferentes para quem está do outro lado. Além disso, a lista de
 * ferramentas entra no prefixo do cache de prompt; variá-la por papel
 * invalidaria o cache a cada usuário diferente.
 */
export function buildTools(ctx: ToolContext): LlmTool[] {
  return DEFINITIONS.map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    run: async (input) => {
      const startedAt = Date.now();

      if (!can(ctx.roles, definition.requires)) {
        await audit(ctx, definition.name, input, null, "DENIED", startedAt);
        return `Acesso negado: o usuário não tem permissão para consultar estes dados (${definition.requires}). Explique isso e não invente os dados.`;
      }

      try {
        const output = await definition.execute(ctx, input);
        await audit(ctx, definition.name, input, output, "OK", startedAt);
        return output;
      } catch (err) {
        logger.warn({ err, tool: definition.name }, "ferramenta do agente falhou");
        const message = err instanceof Error ? err.message : "erro desconhecido";
        await audit(ctx, definition.name, input, message, "ERROR", startedAt);
        // Devolver o erro ao modelo (em vez de propagar) deixa ele tentar outro
        // caminho ou avisar o usuário, em vez de a conversa morrer com 500.
        return `A consulta falhou: ${message}. Informe que não foi possível obter o dado; não invente uma resposta.`;
      }
    },
  }));
}

async function audit(
  ctx: ToolContext,
  tool: string,
  input: unknown,
  output: string | null,
  status: "OK" | "ERROR" | "DENIED",
  startedAt: number,
): Promise<void> {
  try {
    await aiRepo.insertToolCall(ctx.tenantId, ctx.conversationId, {
      tool,
      input,
      output,
      status,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    // A auditoria não pode derrubar a resposta que o usuário está esperando.
    logger.warn({ err, tool }, "falha ao gravar auditoria de ferramenta (ignorada)");
  }
}
