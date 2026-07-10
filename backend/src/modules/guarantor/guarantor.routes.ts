import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { createGuarantorSchema } from "./guarantor.schema.js";
import * as service from "./guarantor.service.js";

/** Rotas de Fiadores. Montadas sob /v1/guarantors (escopo tenant). */
export async function guarantorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.get("/:id", async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.getById(getTenantId(), id) };
  });

  app.post("/", async (req, reply) => {
    const parsed = createGuarantorSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest(
        "Dados do fiador inválidos",
        parsed.error.flatten(),
      );
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });
}
