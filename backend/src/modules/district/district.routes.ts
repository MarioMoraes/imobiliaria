import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import { createDistrictSchema } from "./district.schema.js";
import * as service from "./district.service.js";

/** Rotas de Bairros. Montadas sob /v1/districts (escopo tenant + RBAC). */
export async function districtRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("property:read") }, async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.post("/", { preHandler: requirePermission("property:write") }, async (req, reply) => {
    const parsed = createDistrictSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do bairro inválidos", parsed.error.flatten());
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
