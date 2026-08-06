import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  cashFlowQuerySchema,
  cashFlowSeriesQuerySchema,
  createCashFlowCategorySchema,
  createCashFlowEntrySchema,
  listCashFlowEntriesQuerySchema,
  updateCashFlowCategorySchema,
  updateCashFlowEntrySchema,
} from "./cashflow.schema.js";
import * as service from "./cashflow.service.js";

/**
 * Fluxo de caixa (MOD-FIN). Montadas sob /v1/cash-flow.
 *
 * NÃO confundir com `/v1/receivables/cash-flow`, que é outra coisa: a série
 * "recebido × previsto" das contas a receber, usada no gráfico do dashboard.
 * Este aqui é o extrato consolidado (entradas, saídas, resultado).
 *
 * Leitura sob `finance:read`; escrita (lançamento manual e categorias) sob
 * `finance:write` — é dinheiro entrando e saindo do caixa.
 */
export async function cashFlowRoutes(app: FastifyInstance): Promise<void> {
  /* Rotas estáticas antes de qualquer paramétrica. */

  app.get("/", { preHandler: requirePermission("finance:read") }, async (req) => {
    const parsed = cashFlowQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Mês inválido", parsed.error.flatten());
    }
    return { data: await service.statement(getTenantId(), parsed.data.month) };
  });

  app.get("/series", { preHandler: requirePermission("finance:read") }, async (req) => {
    const parsed = cashFlowSeriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Janela inválida", parsed.error.flatten());
    }
    return { data: await service.series(getTenantId(), parsed.data.months) };
  });

  /* ------------------------------------------------------- Categorias */

  app.get("/categories", { preHandler: requirePermission("finance:read") }, async () => {
    return { data: await service.listCategories(getTenantId()) };
  });

  app.post(
    "/categories",
    { preHandler: requirePermission("finance:write") },
    async (req, reply) => {
      const parsed = createCashFlowCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Dados da categoria inválidos", parsed.error.flatten());
      }
      reply.code(201);
      return { data: await service.createCategory(getTenantId(), parsed.data) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/categories/:id",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      const parsed = updateCashFlowCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Atualização inválida", parsed.error.flatten());
      }
      return {
        data: await service.updateCategory(getTenantId(), req.params.id, parsed.data),
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/categories/:id",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      await service.removeCategory(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );

  /* -------------------------------------------- Lançamentos manuais */

  app.get("/entries", { preHandler: requirePermission("finance:read") }, async (req) => {
    const parsed = listCashFlowEntriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Filtros inválidos", parsed.error.flatten());
    }
    return { data: await service.listEntries(getTenantId(), parsed.data) };
  });

  app.post(
    "/entries",
    { preHandler: requirePermission("finance:write") },
    async (req, reply) => {
      const parsed = createCashFlowEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Dados do lançamento inválidos", parsed.error.flatten());
      }
      reply.code(201);
      return { data: await service.createEntry(getTenantId(), parsed.data) };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/entries/:id",
    { preHandler: requirePermission("finance:read") },
    async (req) => {
      return { data: await service.getEntry(getTenantId(), req.params.id) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/entries/:id",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      const parsed = updateCashFlowEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Atualização inválida", parsed.error.flatten());
      }
      return {
        data: await service.updateEntry(getTenantId(), req.params.id, parsed.data),
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/entries/:id",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      await service.removeEntry(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );
}
