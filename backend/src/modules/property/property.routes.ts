import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import { addOwnerSchema, createPropertySchema } from "./property.schema.js";
import * as service from "./property.service.js";

/**
 * Rotas de imóveis. Montadas sob /v1/properties (ver gateway/routes.ts), já
 * dentro do escopo autenticado (authContextHook). O RBAC é aplicado por rota
 * via `requirePermission` (MOD-AUTH-03).
 */
export async function propertyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("property:read") }, async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.get("/:id", { preHandler: requirePermission("property:read") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.getById(getTenantId(), id) };
  });

  app.post("/", { preHandler: requirePermission("property:write") }, async (req, reply) => {
    const parsed = createPropertySchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do imóvel inválidos", parsed.error.flatten());
    }
    const property = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: property };
  });

  // ── Donos (proprietários) do imóvel ──────────────────────────────
  app.get("/:id/owners", { preHandler: requirePermission("property:read") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.listOwners(getTenantId(), id) };
  });

  app.post("/:id/owners", { preHandler: requirePermission("property:write") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = addOwnerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Vínculo de dono inválido", parsed.error.flatten());
    }
    const property = await service.addOwner(getTenantId(), id, parsed.data.personId, parsed.data.sharePercent);
    reply.code(201);
    return { data: property };
  });

  app.delete(
    "/:id/owners/:personId",
    { preHandler: requirePermission("property:write") },
    async (req) => {
      const { id, personId } = req.params as { id: string; personId: string };
      return { data: await service.removeOwner(getTenantId(), id, personId) };
    },
  );
}
