import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import * as rbac from "../rbac/rbac.service.js";
import { findUserRef } from "../user/user.repository.js";
import * as repo from "./employee.repository.js";
import type {
  CreateEmployeeInput,
  Employee,
  EmployeeAccessStatus,
  UpdateEmployeeInput,
} from "./employee.schema.js";

/**
 * Regras de negócio de Funcionários (MOD-FUNC). Estende o MOD-AUTH: cada
 * funcionário é um `user` com papel(is). Faz cumprir a proteção do "último
 * ADMIN" (RN-01) e mantém o cache de RBAC coerente após mudanças de papel/acesso.
 */

const ERR_NOT_FOUND = new AppError("ERR_FUNC_001", 404, "Funcionário não encontrado");
const ERR_LAST_ADMIN = new AppError(
  "ERR_FUNC_005",
  409,
  "Não é possível remover o último administrador do tenant",
);

export function list(tenantId: string): Promise<Employee[]> {
  return repo.listEmployees(tenantId);
}

export async function getById(tenantId: string, id: string): Promise<Employee> {
  const employee = await repo.findEmployee(tenantId, id);
  if (!employee) throw ERR_NOT_FOUND;
  return employee;
}

export async function create(
  tenantId: string,
  input: CreateEmployeeInput,
): Promise<Employee> {
  if (await repo.findByCpf(tenantId, input.cpf)) {
    throw new AppError("ERR_FUNC_004", 409, "CPF já cadastrado neste tenant", {
      field: "cpf",
      hint: "unifique a identidade sob o mesmo usuário",
    });
  }
  if (await repo.findUserByEmail(tenantId, input.email)) {
    throw new AppError("ERR_FUNC_004", 409, "E-mail já cadastrado neste tenant", {
      field: "email",
    });
  }

  const employee = await repo.insertEmployee(tenantId, input);

  // TODO (MOD-AUTH-06): disparar convite por e-mail; hoje o usuário nasce
  // 'active' sem credencial local — o vínculo com o Clerk vem no aceite.
  await publish({
    type: "employee.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { employeeId: employee.id, userId: employee.userId, roles: employee.roles },
  });

  return employee;
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateEmployeeInput,
): Promise<Employee> {
  const current = await repo.findEmployee(tenantId, id);
  if (!current) throw ERR_NOT_FOUND;

  // Rebaixar o único ADMIN ativo deixaria o tenant sem administrador.
  if (input.roles !== undefined && !input.roles.includes("ADMIN")) {
    await assertNotOrphaningAdmins(tenantId, current);
  }

  const updated = await repo.updateEmployee(tenantId, id, current.userId, input);

  if (input.roles !== undefined) {
    await invalidateAndAnnounce(tenantId, updated, "role.changed", { roles: updated.roles });
  }
  return updated;
}

export async function changeAccess(
  tenantId: string,
  id: string,
  status: EmployeeAccessStatus,
): Promise<Employee> {
  const current = await repo.findEmployee(tenantId, id);
  if (!current) throw ERR_NOT_FOUND;

  if (status !== "ATIVO") {
    await assertNotOrphaningAdmins(tenantId, current);
  }

  const updated = await repo.setAccessStatus(tenantId, id, current.userId, status);

  const eventType =
    status === "REVOGADO"
      ? "employee.access_revoked"
      : status === "SUSPENSO"
        ? "employee.suspended"
        : "employee.reactivated";
  await invalidateAndAnnounce(tenantId, updated, eventType, { accessStatus: status });

  return updated;
}

/** Bloqueia a transição se ela removeria o único ADMIN ativo do tenant (RN-01). */
async function assertNotOrphaningAdmins(tenantId: string, current: Employee): Promise<void> {
  const isActiveAdmin = current.accessStatus === "ATIVO" && current.roles.includes("ADMIN");
  if (!isActiveAdmin) return;
  if ((await repo.countActiveAdmins(tenantId)) <= 1) throw ERR_LAST_ADMIN;
}

/**
 * Invalida o cache de RBAC do usuário (se vinculado ao Clerk) e publica o evento
 * correspondente. Mudanças de papel/acesso precisam valer imediatamente.
 */
async function invalidateAndAnnounce(
  tenantId: string,
  employee: Employee,
  type: string,
  extra: Record<string, unknown>,
): Promise<void> {
  const ref = await findUserRef(tenantId, employee.userId);
  if (ref?.clerkExternalId) await rbac.invalidate(tenantId, ref.clerkExternalId);

  await publish({
    type,
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { employeeId: employee.id, userId: employee.userId, ...extra },
  });
}
