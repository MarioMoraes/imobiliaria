import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  createCondominiumSchema,
  updateCondominiumSchema,
} from "./condominium.schema.js";
import * as service from "./condominium.service.js";

/**
 * Rotas de Condomínio. Montadas sob /v1/condominiums (escopo tenant + RBAC).
 * Leitura: ADMIN/GESTOR/FINANCEIRO; escrita/remoção: ADMIN/GESTOR.
 */
export async function condominiumRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("condominium:read") }, async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("condominium:read") },
    async (req) => {
      return { data: await service.getById(getTenantId(), req.params.id) };
    },
  );

  app.post("/", { preHandler: requirePermission("condominium:write") }, async (req, reply) => {
    const parsed = createCondominiumSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do condomínio inválidos", parsed.error.flatten());
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("condominium:write") },
    async (req) => {
      const parsed = updateCondominiumSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Atualização inválida", parsed.error.flatten());
      }
      return { data: await service.update(getTenantId(), req.params.id, parsed.data) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("condominium:delete") },
    async (req) => {
      await service.remove(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );
}
