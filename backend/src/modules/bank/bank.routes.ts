import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import { createBankSchema, updateBankSchema } from "./bank.schema.js";
import * as service from "./bank.service.js";

/**
 * Rotas de Bancos (contas bancárias da imobiliária). Montadas sob /v1/banks
 * (escopo tenant + RBAC). Leitura/escrita sob finance:*. Os saldos são derivados
 * (rotinas futuras), por isso não há rota para editá-los.
 */
export async function bankRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("finance:read") }, async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.post("/", { preHandler: requirePermission("finance:write") }, async (req, reply) => {
    const parsed = createBankSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do banco inválidos", parsed.error.flatten());
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      const parsed = updateBankSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Dados do banco inválidos", parsed.error.flatten());
      }
      const updated = await service.update(getTenantId(), req.params.id, parsed.data);
      return { data: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      await service.remove(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );
}
