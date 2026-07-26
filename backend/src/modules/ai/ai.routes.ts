import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { getAuthUser, getTenantId } from "../../shared/tenant-context.js";
import { requirePermission } from "../rbac/authorize.js";
import { aiChatSchema, reindexSchema } from "./ai.schema.js";
import * as service from "./ai.service.js";

/**
 * Rotas do copiloto. Montadas sob /v1/ai (ver gateway/routes.ts), já dentro do
 * escopo autenticado.
 *
 * Os papéis do usuário são repassados ao service porque é com ELES que as
 * ferramentas do agente são autorizadas — `ai:use` abre a porta da conversa,
 * não o acesso aos dados (ver tools/registry.ts).
 */
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.post("/chat", { preHandler: requirePermission("ai:use") }, async (req) => {
    const parsed = aiChatSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("ERR_AI_002", 422, "Mensagem inválida", parsed.error.flatten());
    }
    const { userId, roles } = getAuthUser();
    return {
      data: await service.chat(getTenantId(), {
        conversationId: parsed.data.conversationId,
        message: parsed.data.message,
        userId,
        roles,
      }),
    };
  });

  app.get("/conversations", { preHandler: requirePermission("ai:read") }, async () => {
    return { data: await service.listConversations(getTenantId()) };
  });

  app.get<{ Params: { id: string } }>(
    "/conversations/:id",
    { preHandler: requirePermission("ai:read") },
    async (req) => {
      return { data: await service.getConversation(getTenantId(), req.params.id) };
    },
  );

  /**
   * Saldo de créditos. Exige `ai:use`, não `ai:read`, e a distinção é
   * deliberada: `ai:read` protege o HISTÓRICO (que contém o que outras pessoas
   * perguntaram, e por isso é auditoria restrita à gestão). O saldo é cota — é
   * a informação que diz se vale a pena fazer a próxima pergunta, e esconder
   * isso de quem pode perguntar é o mesmo que esconder o marcador de
   * combustível de quem dirige.
   */
  app.get("/credits", { preHandler: requirePermission("ai:use") }, async () => {
    return { data: await service.getCredits(getTenantId()) };
  });

  app.post("/rag/reindex", { preHandler: requirePermission("ai:admin") }, async (req) => {
    const parsed = reindexSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError("ERR_AI_002", 422, "Parâmetros de reindexação inválidos", parsed.error.flatten());
    }
    return { data: await service.reindex(getTenantId(), parsed.data.entityId) };
  });
}
