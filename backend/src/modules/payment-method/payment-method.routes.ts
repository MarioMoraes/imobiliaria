import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
} from "./payment-method.schema.js";
import * as service from "./payment-method.service.js";

/**
 * Formas de pagamento (lookup). Montadas sob /v1/payment-methods.
 *
 * Mesmo gate dos outros lookups de cadastro (Bairros, Tipos de Imóvel): quem
 * cadastra imóvel também mantém as tabelas de apoio que ele usa.
 */
export async function paymentMethodRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("property:read") }, async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.post("/", { preHandler: requirePermission("property:write") }, async (req, reply) => {
    const parsed = createPaymentMethodSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest(
        "Dados da forma de pagamento inválidos",
        parsed.error.flatten(),
      );
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("property:write") },
    async (req) => {
      const parsed = updatePaymentMethodSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest(
          "Dados da forma de pagamento inválidos",
          parsed.error.flatten(),
        );
      }
      return { data: await service.update(getTenantId(), req.params.id, parsed.data) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("property:write") },
    async (req) => {
      await service.remove(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );
}
