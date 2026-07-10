import type { FastifyInstance } from "fastify";
import { healthRoutes } from "../modules/health/health.routes.js";
import { propertyRoutes } from "../modules/property/property.routes.js";
import { tenantRoutes } from "../modules/tenant/tenant.routes.js";
import { validateTenantHook } from "../modules/tenant/tenant.hook.js";
import { tenantContextHook } from "../shared/tenant-context.js";

/**
 * Gateway / composição de rotas (SPEC seção 4.3). Ponto único que agrega
 * as rotas dos módulos de domínio. Cada módulo novo é registrado aqui sob
 * seu prefixo em /v1.
 *
 * - /health*        → público, sem tenant
 * - /v1/*           → exige tenant (tenantContextHook aplicado no escopo)
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Público
  await app.register(healthRoutes);

  // Administração da plataforma (Super Admin). Fora de /v1: não é escopado por
  // tenant. TODO: proteger com autorização de Super Admin.
  await app.register(tenantRoutes, { prefix: "/admin/tenants" });

  // API versionada, isolada por tenant
  await app.register(
    async (v1) => {
      // 1) resolve e valida o tenant (existe + ativo); 2) entra no AsyncLocalStorage.
      v1.addHook("onRequest", validateTenantHook);
      v1.addHook("onRequest", tenantContextHook);
      await v1.register(propertyRoutes, { prefix: "/properties" });
      // Próximos módulos entram aqui:
      // await v1.register(ownerRoutes,    { prefix: "/owners" });
      // await v1.register(customerRoutes, { prefix: "/customers" });
    },
    { prefix: "/v1" },
  );
}
