import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import { createBrokerSchema, updateBrokerSchema } from "./broker.schema.js";
import * as service from "./broker.service.js";

/**
 * Rotas de Corretores. Montadas sob /v1/brokers (escopo tenant + RBAC).
 * Leitura: ADMIN/GESTOR/FINANCEIRO/CORRETOR; escrita: ADMIN/GESTOR; remoção: ADMIN.
 */
export async function brokerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("broker:read") }, async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.post("/", { preHandler: requirePermission("broker:write") }, async (req, reply) => {
    const parsed = createBrokerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do corretor inválidos", parsed.error.flatten());
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("broker:write") },
    async (req) => {
      const parsed = updateBrokerSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Atualização do corretor inválida", parsed.error.flatten());
      }
      return { data: await service.update(getTenantId(), req.params.id, parsed.data) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("broker:delete") },
    async (req) => {
      await service.remove(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );
}
