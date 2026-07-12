import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  addInteractionSchema,
  createCustomerSchema,
  searchProfileInput,
  updateCustomerSchema,
} from "./customer.schema.js";
import * as service from "./customer.service.js";

/**
 * Clientes (MOD-CLIENTE). Montadas sob /v1/customers (escopo tenant + RBAC).
 * Leitura: ADMIN/GESTOR/CORRETOR; escrita: idem + AI_AGENT; delete: ADMIN/GESTOR
 * (AI_AGENT nunca deleta — RN-04). Ver matriz em rbac/permissions.ts.
 */
export async function customerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("customer:read") }, async (req) => {
    const q = req.query as { stage?: string; broker?: string };
    return { data: await service.list(getTenantId(), { stage: q.stage, brokerId: q.broker }) };
  });

  app.get("/:id", { preHandler: requirePermission("customer:read") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.getById(getTenantId(), id) };
  });

  app.post("/", { preHandler: requirePermission("customer:write") }, async (req, reply) => {
    const parsed = createCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do cliente inválidos", parsed.error.flatten());
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });

  app.patch("/:id", { preHandler: requirePermission("customer:write") }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = updateCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Atualização inválida", parsed.error.flatten());
    }
    return { data: await service.update(getTenantId(), id, parsed.data) };
  });

  app.post(
    "/:id/search-profiles",
    { preHandler: requirePermission("customer:write") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = searchProfileInput.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Perfil de busca inválido", parsed.error.flatten());
      }
      const updated = await service.addSearchProfile(getTenantId(), id, parsed.data);
      reply.code(201);
      return { data: updated };
    },
  );

  app.post(
    "/:id/interactions",
    { preHandler: requirePermission("customer:write") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = addInteractionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Interação inválida", parsed.error.flatten());
      }
      const updated = await service.addInteraction(getTenantId(), id, parsed.data);
      reply.code(201);
      return { data: updated };
    },
  );

  app.delete("/:id", { preHandler: requirePermission("customer:delete") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.inactivate(getTenantId(), id) };
  });
}
