import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import * as rbac from "../rbac/rbac.service.js";
import * as repo from "./user.repository.js";
import type { UserRole, UserWithRoles } from "./user.schema.js";

export function list(tenantId: string): Promise<UserWithRoles[]> {
  return repo.listUsersWithRoles(tenantId);
}

/**
 * Altera o papel de um usuário (ADMIN). Publica `role.changed` e invalida o
 * cache de RBAC do usuário para que a mudança valha imediatamente.
 */
export async function changeRole(
  tenantId: string,
  userId: string,
  role: UserRole,
): Promise<UserWithRoles> {
  const ref = await repo.findUserRef(tenantId, userId);
  if (!ref) throw AppError.notFound("Usuário não encontrado");

  const updated = await repo.setUserRole(tenantId, userId, role);

  if (ref.clerkExternalId) await rbac.invalidate(tenantId, ref.clerkExternalId);

  await publish({
    type: "role.changed",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { userId, role },
  });

  return updated;
}
