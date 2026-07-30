import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { getTenantId } from "../../shared/tenant-context.js";
import { requirePermission } from "../rbac/authorize.js";
import { auditQuery, globalAuditQuery } from "./audit.schema.js";
import * as service from "./audit.service.js";

/**
 * Trilha do próprio tenant (MOD-AUTH-07). Montada em /v1/audit — só leitura:
 * não existe rota que escreva, edite ou apague um registro. O que entra na
 * trilha é decidido pelo gateway e pelos `record()` dos módulos.
 */
export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("audit:read") }, async (req) => {
    const parsed = auditQuery.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Filtros de auditoria inválidos", parsed.error.flatten());
    }
    return { data: await service.list(getTenantId(), parsed.data) };
  });
}

/**
 * Visão global cross-tenant (MOD-SADMIN-04). Montada em /admin/audit, sob o
 * `platformAdminHook` — é a exceção controlada ao isolamento prevista no SPEC
 * 9.4, e por isso lê via escopo de plataforma, não via tenant.
 */
export async function adminAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (req) => {
    const parsed = globalAuditQuery.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Filtros de auditoria inválidos", parsed.error.flatten());
    }
    return { data: await service.listGlobal(parsed.data) };
  });

  app.get("/summary", async () => {
    return { data: await service.summary() };
  });

  /**
   * Expurgo de retenção. Manual de propósito: o projeto não tem agendador, e a
   * policy do banco só permite remover linhas com mais de 12 meses — pedir uma
   * janela menor não apaga nada.
   */
  app.post("/purge", async () => {
    const removed = await service.purge();
    return { data: { removed } };
  });
}
