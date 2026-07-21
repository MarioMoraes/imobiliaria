import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { getTenantId } from "../../shared/tenant-context.js";
import { requirePermission } from "../rbac/authorize.js";
import { createTenantSchema, updateTenantSchema } from "./tenant.schema.js";
import * as service from "./tenant.service.js";

/**
 * Rotas administrativas de tenants (Super Admin — PRD seção 7.18).
 * Montadas sob /admin/tenants, FORA do escopo /v1: são operações de
 * plataforma, não escopadas por tenant. TODO Fundação: proteger com
 * autorização de Super Admin (auth-service/Clerk).
 */
export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => {
    return { data: await service.list() };
  });

  app.get("/:id", async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.getById(id) };
  });

  app.post("/", async (req, reply) => {
    const parsed = createTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do tenant inválidos", parsed.error.flatten());
    }
    const tenant = await service.create(parsed.data);
    reply.code(201);
    return { data: tenant };
  });

  app.patch("/:id", async (req) => {
    const { id } = req.params as { id: string };
    const parsed = updateTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do tenant inválidos", parsed.error.flatten());
    }
    return { data: await service.update(id, parsed.data) };
  });
}

/**
 * A **própria** imobiliária (cadastro em Configurações). Montado em /v1/tenant,
 * dentro do escopo autenticado: o id vem do contexto (`getTenantId`), nunca da
 * URL — assim um admin não alcança o cadastro de outra imobiliária, ao
 * contrário das rotas /admin/tenants acima, que são de plataforma.
 */
export async function currentTenantRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("tenant:config:read") }, async () => {
    return { data: await service.getById(getTenantId()) };
  });

  app.patch("/", { preHandler: requirePermission("tenant:config:write") }, async (req) => {
    const parsed = updateTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados da imobiliária inválidos", parsed.error.flatten());
    }
    // `status` e `plan` são decisões de plataforma (billing/suspensão): mesmo
    // que cheguem no corpo, não podem ser mudados pelo próprio tenant.
    const { status: _status, plan: _plan, ...safe } = parsed.data;
    return { data: await service.update(getTenantId(), safe) };
  });
}
