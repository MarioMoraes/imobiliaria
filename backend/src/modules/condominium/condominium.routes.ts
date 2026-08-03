import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  condoBillingQuerySchema,
  createCondominiumSchema,
  createExpenseSchema,
  updateCondominiumSchema,
  updateExpenseSchema,
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

  // ── Cobrança do condomínio (contas a receber do período) ─────────
  // Prévia em GET: o hook de auditoria registra POST/PATCH/DELETE, e um cálculo
  // que não grava nada não deve virar linha na trilha.
  app.get<{ Params: { id: string } }>(
    "/:id/billing",
    { preHandler: requirePermission("condominium:read") },
    async (req) => {
      const parsed = condoBillingQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw AppError.badRequest("Período inválido", parsed.error.flatten());
      }
      return { data: await service.previewBilling(getTenantId(), req.params.id, parsed.data) };
    },
  );

  // Cobranças já geradas deste condomínio (lista de condôminos). Leitura
  // financeira: são contas a receber, não cadastro do condomínio.
  app.get<{ Params: { id: string } }>(
    "/:id/charges",
    { preHandler: requirePermission("finance:read") },
    async (req) => {
      return { data: await service.listCharges(getTenantId(), req.params.id) };
    },
  );

  /**
   * Relatório de conferência do mesmo período, em PDF. Responde os BYTES, não
   * o envelope `{ data }` das demais rotas — quem chama abre/imprime o arquivo.
   * Segue a leitura (`condominium:read`): é a prévia impressa, não uma escrita.
   */
  app.get<{ Params: { id: string } }>(
    "/:id/billing/report",
    { preHandler: requirePermission("condominium:read") },
    async (req, reply) => {
      const parsed = condoBillingQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw AppError.badRequest("Período inválido", parsed.error.flatten());
      }
      const pdf = await service.billingReport(getTenantId(), req.params.id, parsed.data);

      // `inline` abre no visualizador do navegador; o nome é o que o "salvar
      // como" sugere — sem ele o arquivo herdaria o nome da rota ("report.pdf").
      reply
        .header("Content-Type", "application/pdf")
        .header(
          "Content-Disposition",
          `inline; filename="cobranca-condominio-${parsed.data.periodStart}.pdf"`,
        );
      return reply.send(pdf);
    },
  );

  // Gerar é escrita no financeiro — permissão de financeiro, não de condomínio.
  app.post<{ Params: { id: string } }>(
    "/:id/billing",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      const parsed = condoBillingQuerySchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Período inválido", parsed.error.flatten());
      }
      return { data: await service.generateBilling(getTenantId(), req.params.id, parsed.data) };
    },
  );

  // ── Despesas do condomínio ("Cadastro de Despesas") ──────────────
  app.get<{ Params: { id: string } }>(
    "/:id/expenses",
    { preHandler: requirePermission("condominium:read") },
    async (req) => {
      return { data: await service.listExpenses(getTenantId(), req.params.id) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/expenses",
    { preHandler: requirePermission("condominium:write") },
    async (req, reply) => {
      const parsed = createExpenseSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Dados da despesa inválidos", parsed.error.flatten());
      }
      const created = await service.createExpense(getTenantId(), req.params.id, parsed.data);
      reply.code(201);
      return { data: created };
    },
  );

  app.patch<{ Params: { id: string; expenseId: string } }>(
    "/:id/expenses/:expenseId",
    { preHandler: requirePermission("condominium:write") },
    async (req) => {
      const parsed = updateExpenseSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Atualização da despesa inválida", parsed.error.flatten());
      }
      const updated = await service.updateExpense(
        getTenantId(),
        req.params.id,
        req.params.expenseId,
        parsed.data,
      );
      return { data: updated };
    },
  );

  app.delete<{ Params: { id: string; expenseId: string } }>(
    "/:id/expenses/:expenseId",
    { preHandler: requirePermission("condominium:delete") },
    async (req) => {
      await service.removeExpense(getTenantId(), req.params.id, req.params.expenseId);
      return { data: { deleted: true } };
    },
  );
}
