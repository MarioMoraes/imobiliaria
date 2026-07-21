import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { getTenantId } from "../../shared/tenant-context.js";
import { requirePermission } from "../rbac/authorize.js";
import { searchQuerySchema } from "./search.schema.js";
import * as service from "./search.service.js";

/**
 * Busca global (barra do topo). Montada em /v1/search.
 *
 * Exige `property:read` — o menor denominador entre os domínios consultados;
 * todos os papéis que enxergam a barra já têm essa permissão. Os resultados são
 * do tenant da sessão (RLS), então não há como sondar dados de outra
 * imobiliária pelo termo.
 */
export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("property:read") }, async (req) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Busca inválida", parsed.error.flatten());
    }
    return {
      data: await service.search(getTenantId(), parsed.data.q, parsed.data.limit),
    };
  });
}
