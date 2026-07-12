import type { FastifyInstance } from "fastify";
import { healthRoutes } from "../modules/health/health.routes.js";
import { authRoutes } from "../modules/auth/auth.routes.js";
import { propertyRoutes } from "../modules/property/property.routes.js";
import { propertyTypeRoutes } from "../modules/property-type/property-type.routes.js";
import { guarantorRoutes } from "../modules/guarantor/guarantor.routes.js";
import { tenantRoutes } from "../modules/tenant/tenant.routes.js";
import { userRoutes } from "../modules/user/user.routes.js";
import { authContextHook } from "./auth-context.hook.js";

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

  // Auth público: onboarding cria o tenant (ainda não há tenant a resolver),
  // por isso fica FORA do escopo /v1 tenant-scoped abaixo. Paths não colidem
  // com as rotas de domínio (/v1/auth/* vs /v1/properties, etc.).
  await app.register(authRoutes, { prefix: "/v1/auth" });

  // API versionada, isolada por tenant e autenticada
  await app.register(
    async (v1) => {
      // Resolve identidade (Clerk/dev) + tenant ativo + papéis, e entra no
      // AsyncLocalStorage. As rotas usam `requirePermission(...)` para o RBAC.
      v1.addHook("onRequest", authContextHook);
      await v1.register(propertyRoutes, { prefix: "/properties" });
      await v1.register(propertyTypeRoutes, { prefix: "/property-types" });
      await v1.register(guarantorRoutes, { prefix: "/guarantors" });
      await v1.register(userRoutes, { prefix: "/users" });
      // Próximos módulos entram aqui:
      // await v1.register(ownerRoutes,    { prefix: "/owners" });
      // await v1.register(customerRoutes, { prefix: "/customers" });
    },
    { prefix: "/v1" },
  );
}
