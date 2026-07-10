import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { createPropertySchema } from "./property.schema.js";
import * as service from "./property.service.js";

/**
 * Rotas de imóveis. Montadas sob /v1/properties (ver gateway/routes.ts),
 * já dentro do escopo protegido pelo tenantContextHook.
 */
export async function propertyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.get("/:id", async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.getById(getTenantId(), id) };
  });

  app.post("/", async (req, reply) => {
    const parsed = createPropertySchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do imóvel inválidos", parsed.error.flatten());
    }
    const property = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: property };
  });
}
