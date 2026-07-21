import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  createReceivableSchema,
  listReceivablesQuerySchema,
  settleReceivableSchema,
  updateReceivableSchema,
} from "./receivable.schema.js";
import * as service from "./receivable.service.js";

/**
 * Contas a receber (MOD-FIN). Montadas sob /v1/receivables, dentro do escopo
 * autenticado. Leitura para quem vê financeiro; escrita só ADMIN/FINANCEIRO.
 */
export async function receivableRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("finance:read") }, async (req) => {
    const parsed = listReceivablesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Filtros inválidos", parsed.error.flatten());
    }
    return { data: await service.list(getTenantId(), parsed.data) };
  });

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("finance:read") },
    async (req) => {
      return { data: await service.getById(getTenantId(), req.params.id) };
    },
  );

  app.post("/", { preHandler: requirePermission("finance:write") }, async (req, reply) => {
    const parsed = createReceivableSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados da cobrança inválidos", parsed.error.flatten());
    }
    reply.code(201);
    return { data: await service.create(getTenantId(), parsed.data) };
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      const parsed = updateReceivableSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Atualização inválida", parsed.error.flatten());
      }
      return { data: await service.update(getTenantId(), req.params.id, parsed.data) };
    },
  );

  // Baixa manual do pagamento (o gateway ainda não está integrado).
  app.post<{ Params: { id: string } }>(
    "/:id/settle",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      const parsed = settleReceivableSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw AppError.badRequest("Dados da baixa inválidos", parsed.error.flatten());
      }
      return { data: await service.settle(getTenantId(), req.params.id, parsed.data) };
    },
  );

  // A emissão do boleto (POST /:id/boleto) vive no MOD-FIN/pagamento, que é
  // quem conhece o Asaas — registrada neste mesmo prefixo em gateway/routes.ts.

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      await service.remove(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );
}
