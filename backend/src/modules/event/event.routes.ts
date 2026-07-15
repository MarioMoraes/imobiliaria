import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import { createEventSchema } from "./event.schema.js";
import * as service from "./event.service.js";

/**
 * Rotas de Eventos financeiros. Montadas sob /v1/events (escopo tenant + RBAC).
 * Parâmetros de cobrança (juros/multa) → leitura/escrita sob finance:*.
 */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("finance:read") }, async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.post("/", { preHandler: requirePermission("finance:write") }, async (req, reply) => {
    const parsed = createEventSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do evento inválidos", parsed.error.flatten());
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      await service.remove(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );
}
