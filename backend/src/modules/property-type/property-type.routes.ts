import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { createPropertyTypeSchema } from "./property-type.schema.js";
import * as service from "./property-type.service.js";

/** Rotas de Tipo de Imóvel. Montadas sob /v1/property-types (escopo tenant). */
export async function propertyTypeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.post("/", async (req, reply) => {
    const parsed = createPropertyTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest(
        "Dados do tipo de imóvel inválidos",
        parsed.error.flatten(),
      );
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });
}
