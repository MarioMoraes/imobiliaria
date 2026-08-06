import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  createSaleSchema,
  listSalesQuerySchema,
  updateSaleSchema,
} from "./sale.schema.js";
import * as service from "./sale.service.js";

/** Vendas de imóvel (MOD-VENDA). Montadas sob /v1/sales. */
export async function saleRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { propertyId?: string } }>(
    "/",
    { preHandler: requirePermission("sale:read") },
    async (req) => {
      const parsed = listSalesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw AppError.badRequest("Filtro inválido", parsed.error.flatten());
      }
      return { data: await service.list(getTenantId(), parsed.data) };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("sale:read") },
    async (req) => {
      return { data: await service.getById(getTenantId(), req.params.id) };
    },
  );

  app.post("/", { preHandler: requirePermission("sale:write") }, async (req, reply) => {
    const parsed = createSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados da venda inválidos", parsed.error.flatten());
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("sale:write") },
    async (req) => {
      const parsed = updateSaleSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Dados da venda inválidos", parsed.error.flatten());
      }
      return { data: await service.update(getTenantId(), req.params.id, parsed.data) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("sale:delete") },
    async (req) => {
      await service.remove(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );
}
