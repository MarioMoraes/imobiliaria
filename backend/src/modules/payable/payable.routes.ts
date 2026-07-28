import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  createPayableSchema,
  listPayablesQuerySchema,
  payableSummaryQuerySchema,
  settlePayableSchema,
  updatePayableSchema,
} from "./payable.schema.js";
import * as service from "./payable.service.js";

/**
 * Contas a pagar / repasse ao proprietário (MOD-FIN). Montadas sob /v1/payables.
 * Mesmas permissões do contas a receber: leitura para quem vê financeiro,
 * escrita só ADMIN/FINANCEIRO — é dinheiro saindo.
 */
export async function payableRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("finance:read") }, async (req) => {
    const parsed = listPayablesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Filtros inválidos", parsed.error.flatten());
    }
    return { data: await service.list(getTenantId(), parsed.data) };
  });

  // Indicadores do mês. Rota estática antes da paramétrica por clareza.
  app.get("/summary", { preHandler: requirePermission("finance:read") }, async (req) => {
    const parsed = payableSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Mês inválido", parsed.error.flatten());
    }
    return { data: await service.summary(getTenantId(), parsed.data.month) };
  });

  /**
   * Relatório da competência em PDF. Responde os BYTES (application/pdf), e não
   * o envelope `{ data }` das demais rotas — quem chama abre/imprime o arquivo.
   */
  app.get("/report", { preHandler: requirePermission("finance:read") }, async (req, reply) => {
    const parsed = payableSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Mês inválido", parsed.error.flatten());
    }
    const month = parsed.data.month ?? new Date().toISOString().slice(0, 7);
    const pdf = await service.report(getTenantId(), month);

    // `inline` abre no visualizador do navegador; o nome é o que o "salvar como"
    // sugere — sem ele o arquivo herdaria o nome da rota ("report.pdf").
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="repasses-${month}.pdf"`);
    return reply.send(pdf);
  });

  /**
   * Reconciliação dos repasses pendentes. É POST porque escreve, mas é seguro
   * repetir: o único (receivable_id, payee_person_id) descarta o que já existe.
   */
  app.post("/generate", { preHandler: requirePermission("finance:write") }, async () => {
    return { data: await service.generatePending(getTenantId()) };
  });

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("finance:read") },
    async (req) => {
      return { data: await service.getById(getTenantId(), req.params.id) };
    },
  );

  app.post("/", { preHandler: requirePermission("finance:write") }, async (req, reply) => {
    const parsed = createPayableSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do lançamento inválidos", parsed.error.flatten());
    }
    reply.code(201);
    return { data: await service.create(getTenantId(), parsed.data) };
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      const parsed = updatePayableSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Atualização inválida", parsed.error.flatten());
      }
      return { data: await service.update(getTenantId(), req.params.id, parsed.data) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/settle",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      const parsed = settlePayableSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw AppError.badRequest("Dados da baixa inválidos", parsed.error.flatten());
      }
      return { data: await service.settle(getTenantId(), req.params.id, parsed.data) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/cancel",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      return { data: await service.cancel(getTenantId(), req.params.id) };
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
