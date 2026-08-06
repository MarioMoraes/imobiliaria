import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  createCommissionSchema,
  listCommissionsQuerySchema,
  settleCommissionSchema,
  updateCommissionSchema,
} from "./commission.schema.js";
import * as service from "./commission.service.js";

/**
 * Comissões (MOD-FIN-05). Montadas sob /v1/commissions.
 *
 * Mesmas permissões do contas a pagar: leitura para quem vê financeiro, escrita
 * só ADMIN/FINANCEIRO. O recorte "CORRETOR vê as próprias" do PRD fica para
 * quando o portal do corretor existir — ver o header do service.
 */
export async function commissionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("finance:read") }, async (req) => {
    const parsed = listCommissionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Filtros inválidos", parsed.error.flatten());
    }
    return { data: await service.list(getTenantId(), parsed.data) };
  });

  // Rota estática antes da paramétrica: "/summary" não pode cair no "/:id".
  app.get("/summary", { preHandler: requirePermission("finance:read") }, async (req) => {
    const month = (req.query as { month?: string })?.month;
    if (month !== undefined && !/^\d{4}-\d{2}$/.test(month)) {
      throw AppError.badRequest("Mês inválido (YYYY-MM)");
    }
    return { data: await service.summary(getTenantId(), month) };
  });

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("finance:read") },
    async (req) => {
      return { data: await service.getById(getTenantId(), req.params.id) };
    },
  );

  app.post("/", { preHandler: requirePermission("finance:write") }, async (req, reply) => {
    const parsed = createCommissionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados da comissão inválidos", parsed.error.flatten());
    }
    reply.code(201);
    return { data: await service.create(getTenantId(), parsed.data) };
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      const parsed = updateCommissionSchema.safeParse(req.body);
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
      const parsed = settleCommissionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw AppError.badRequest("Dados da quitação inválidos", parsed.error.flatten());
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
