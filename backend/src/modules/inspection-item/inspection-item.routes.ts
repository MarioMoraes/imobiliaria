import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import { createInspectionItemSchema } from "./inspection-item.schema.js";
import * as service from "./inspection-item.service.js";

/** Rotas de Itens de Vistoria. Montadas sob /v1/inspection-items (tenant + RBAC). */
export async function inspectionItemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("property:read") }, async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.post("/", { preHandler: requirePermission("property:write") }, async (req, reply) => {
    const parsed = createInspectionItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do item de vistoria inválidos", parsed.error.flatten());
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("property:write") },
    async (req) => {
      await service.remove(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );
}
