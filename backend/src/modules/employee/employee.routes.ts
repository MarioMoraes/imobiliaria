import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  changeAccessSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
} from "./employee.schema.js";
import * as service from "./employee.service.js";

/**
 * Funcionários (MOD-FUNC). Montadas sob /v1/employees (escopo tenant + RBAC).
 * Leitura: ADMIN/GESTOR (`users:read`); mutação: ADMIN (`users:manage`) — a
 * gestão de acesso é privativa do ADMIN, alinhada à matriz canônica do MOD-AUTH.
 */
export async function employeeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("users:read") }, async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.get("/:id", { preHandler: requirePermission("users:read") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.getById(getTenantId(), id) };
  });

  app.post("/", { preHandler: requirePermission("users:manage") }, async (req, reply) => {
    const parsed = createEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do funcionário inválidos", parsed.error.flatten());
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });

  app.patch("/:id", { preHandler: requirePermission("users:manage") }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = updateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Atualização inválida", parsed.error.flatten());
    }
    return { data: await service.update(getTenantId(), id, parsed.data) };
  });

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("users:manage") },
    async (req) => {
      await service.remove(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );

  // Reenvio do convite de acesso. Devolve o link do ticket junto com
  // `emailSent`: quando a entrega falha, a UI oferece copiar o link.
  app.post(
    "/:id/invite/resend",
    { preHandler: requirePermission("users:manage") },
    async (req) => {
      const { id } = req.params as { id: string };
      return { data: await service.resendInvite(getTenantId(), id) };
    },
  );

  app.patch(
    "/:id/access",
    { preHandler: requirePermission("users:manage") },
    async (req) => {
      const { id } = req.params as { id: string };
      const parsed = changeAccessSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Status de acesso inválido", parsed.error.flatten());
      }
      return { data: await service.changeAccess(getTenantId(), id, parsed.data.status) };
    },
  );
}
