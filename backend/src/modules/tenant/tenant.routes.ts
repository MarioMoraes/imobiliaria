import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
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
