import type { FastifyInstance } from "fastify";
import { getAuthUser, getTenantId } from "../../shared/tenant-context.js";
import { requirePermission } from "../rbac/authorize.js";
import { can } from "../rbac/permissions.js";
import * as service from "./dashboard.service.js";

/**
 * Rotas do painel inicial. Montadas sob /v1/dashboard (escopo tenant + RBAC).
 *
 * O gate da rota é `property:read` — o menor denominador comum de quem enxerga
 * o painel. Os números financeiros são somados só para quem também tem
 * `finance:read`; para os demais o bloco vem nulo (ver service).
 */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/summary", { preHandler: requirePermission("property:read") }, async () => {
    const { roles } = getAuthUser();
    return { data: await service.summary(getTenantId(), can(roles, "finance:read")) };
  });
}
