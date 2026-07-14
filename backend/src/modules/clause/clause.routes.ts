import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import { createClauseSchema } from "./clause.schema.js";
import * as service from "./clause.service.js";

/** Rotas de Cláusulas contratuais. Montadas sob /v1/clauses (tenant + RBAC). */
export async function clauseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("contract:read") }, async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.post("/", { preHandler: requirePermission("contract:write") }, async (req, reply) => {
    const parsed = createClauseSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados da cláusula inválidos", parsed.error.flatten());
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("contract:write") },
    async (req) => {
      await service.remove(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );
}
