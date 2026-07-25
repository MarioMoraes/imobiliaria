import type { FastifyInstance } from "fastify";
import { getTenantId, getAuthUser } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import { changeRoleSchema } from "./user.schema.js";
import * as service from "./user.service.js";

/**
 * Gestão de usuários do tenant (MOD-AUTH-03/06 parcial). Montada sob /v1/users.
 * Convite por e-mail (MOD-AUTH-06) fica como TODO.
 */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Perfil do próprio usuário logado: papéis resolvidos do token (ou fallback de
  // dev). Não exige permissão — todo usuário autenticado pode se consultar.
  app.get("/me", async () => {
    const { userId, roles } = getAuthUser();
    return { data: { userId: userId ?? null, roles } };
  });

  app.get("/", { preHandler: requirePermission("users:read") }, async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.patch(
    "/:id/role",
    { preHandler: requirePermission("users:manage") },
    async (req) => {
      const { id } = req.params as { id: string };
      const parsed = changeRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Papel inválido", parsed.error.flatten());
      }
      // Ninguém muda o próprio papel: fecha a autopromoção e também evita o
      // auto-lockout (o último ADMIN se rebaixando e deixando o tenant sem
      // administrador).
      const { userId } = getAuthUser();
      if (userId && userId === id) {
        throw new AppError(
          "ERR_AUTH_003",
          403,
          "Não é possível alterar o seu próprio papel. Peça a outro administrador.",
        );
      }
      return { data: await service.changeRole(getTenantId(), id, parsed.data.role) };
    },
  );
}
