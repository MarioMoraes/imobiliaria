import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { getAuthUser, getTenantId } from "../../shared/tenant-context.js";
import { requireAnyPermission } from "../rbac/authorize.js";
import { searchQuerySchema } from "./search.schema.js";
import * as service from "./search.service.js";

/**
 * Busca global (barra do topo). Montada em /v1/search.
 *
 * A rota só verifica se o usuário pode ler ALGUM dos domínios da busca; a
 * autorização de verdade é por bucket, dentro do service (ver `search.service`).
 * Gatear em uma permissão só deixava um papel ler, pela barra, o que o endpoint
 * dedicado lhe nega. Os resultados são do tenant da sessão (RLS), então não há
 * como sondar dados de outra imobiliária pelo termo.
 */
const SEARCHABLE = ["property:read", "person:read", "contract:read"] as const;

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requireAnyPermission(SEARCHABLE) }, async (req) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Busca inválida", parsed.error.flatten());
    }
    const { roles } = getAuthUser();
    return {
      data: await service.search(getTenantId(), parsed.data.q, parsed.data.limit, roles),
    };
  });
}
