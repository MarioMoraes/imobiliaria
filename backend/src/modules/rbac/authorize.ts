import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors.js";
import { getAuthUser } from "../../shared/tenant-context.js";
import { can, type Operation } from "./permissions.js";

/**
 * Guard de autorização por papel (MOD-AUTH-03). Uso como `preHandler` de rota:
 *   app.delete("/:id", { preHandler: requirePermission("property:delete") }, handler)
 *
 * - usuário sem nenhum papel ativo  → 403 ERR_AUTH_007
 * - papel insuficiente p/ a operação → 403 ERR_AUTH_003
 */
export function requirePermission(op: Operation) {
  return async function (_req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const { roles } = getAuthUser();
    if (roles.length === 0) {
      throw new AppError("ERR_AUTH_007", 403, "Usuário sem papel ativo");
    }
    if (!can(roles, op)) {
      throw new AppError("ERR_AUTH_003", 403, "Papel insuficiente para esta operação");
    }
  };
}
