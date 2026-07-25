import { withTenant } from "../../shared/db.js";
import type { PoolClient } from "pg";
import type {
  CreateEmployeeInput,
  Employee,
  EmployeeAccessStatus,
  EmployeeRole,
  UpdateEmployeeInput,
} from "./employee.schema.js";

/**
 * Acesso a dados de funcionários. Tudo passa por `withTenant` (RLS): um tenant
 * nunca enxerga/edita funcionários — nem os `users` vinculados — de outro.
 * Um funcionário é `employees` + `users` + `user_roles`, criados/alterados numa
 * única transação para nunca deixar um colaborador sem identidade ou sem papel.
 */

interface Row {
  id: string;
  tenant_id: string;
  user_id: string;
  cpf: string;
  position: string;
  hired_at: string | null;   // DATE -> string (ver setTypeParser em shared/db.ts)
  access_status: string;
  created_at: Date;
  updated_at: Date;
  email: string;
  full_name: string;
  user_status: string;
  roles: string[];
}

/** access_status do funcionário → users.status (fonte da verdade do login). */
function userStatusFor(access: EmployeeAccessStatus): "active" | "disabled" {
  return access === "ATIVO" ? "active" : "disabled";
}

function toEmployee(row: Row): Employee {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    cpf: row.cpf,
    position: row.position,
    hiredAt: row.hired_at,
    accessStatus: row.access_status as EmployeeAccessStatus,
    userStatus: row.user_status,
    roles: row.roles,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT_EMPLOYEE = `
  SELECT e.id, e.tenant_id, e.user_id, e.cpf, e.position, e.hired_at,
         e.access_status, e.created_at, e.updated_at,
         u.email, u.full_name, u.status AS user_status,
         COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
    FROM employees e
    JOIN users u ON u.id = e.user_id
    LEFT JOIN user_roles ur ON ur.user_id = u.id`;

export function listEmployees(tenantId: string): Promise<Employee[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `${SELECT_EMPLOYEE} GROUP BY e.id, u.email, u.full_name, u.status ORDER BY e.created_at DESC LIMIT 200`,
    );
    return rows.map(toEmployee);
  });
}

export function findEmployee(tenantId: string, id: string): Promise<Employee | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `${SELECT_EMPLOYEE} WHERE e.id = $1 GROUP BY e.id, u.email, u.full_name, u.status`,
      [id],
    );
    return rows[0] ? toEmployee(rows[0]) : null;
  });
}

/** Conflito de identidade (MOD-FUNC AC-03): CPF já usado por outro funcionário. */
export function findByCpf(tenantId: string, cpf: string): Promise<{ id: string } | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM employees WHERE cpf = $1",
      [cpf],
    );
    return rows[0] ?? null;
  });
}

/** Conflito de identidade: e-mail já usado por um usuário do tenant. */
export function findUserByEmail(tenantId: string, email: string): Promise<{ id: string } | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE lower(email) = lower($1)",
      [email],
    );
    return rows[0] ?? null;
  });
}

/**
 * Nº de usuários com papel ADMIN e acesso ativo no tenant. Base da regra do
 * "último ADMIN" (RN-01): não se pode revogar/rebaixar o único administrador.
 */
export function countActiveAdmins(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ n: string }>(
      `SELECT COUNT(DISTINCT u.id)::int AS n
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.role = 'ADMIN' AND u.status = 'active'`,
    );
    return Number(rows[0]?.n ?? 0);
  });
}

async function replaceRoles(
  client: PoolClient,
  tenantId: string,
  userId: string,
  roles: EmployeeRole[],
): Promise<void> {
  await client.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
  for (const role of roles) {
    await client.query(
      "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)",
      [tenantId, userId, role],
    );
  }
}

export function insertEmployee(
  tenantId: string,
  input: CreateEmployeeInput,
  userStatus: "active" | "invited",
): Promise<Employee> {
  return withTenant(tenantId, async (client) => {
    const { rows: userRows } = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, full_name, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [tenantId, input.email, input.fullName, userStatus],
    );
    const userId = userRows[0]!.id;

    await replaceRoles(client, tenantId, userId, input.roles);

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO employees (tenant_id, user_id, cpf, position, hired_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [tenantId, userId, input.cpf, input.position, input.hiredAt ?? null],
    );
    const employee = await loadOne(client, rows[0]!.id);
    return employee;
  });
}

/**
 * Remove o funcionário e sua identidade (rollback do cadastro quando o convite
 * do Clerk falha). `user_roles` cai por FK/cascata ao apagar `users`; apagamos
 * `employees` antes para não violar a FK employees→users.
 */
export function removeEmployee(
  tenantId: string,
  id: string,
  userId: string,
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    await client.query("DELETE FROM employees WHERE id = $1", [id]);
    await client.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
  });
}

export function updateEmployee(
  tenantId: string,
  id: string,
  userId: string,
  input: UpdateEmployeeInput,
): Promise<Employee> {
  return withTenant(tenantId, async (client) => {
    if (input.position !== undefined || input.hiredAt !== undefined) {
      await client.query(
        `UPDATE employees
            SET position = COALESCE($2, position),
                hired_at = CASE WHEN $3::boolean THEN $4::date ELSE hired_at END,
                updated_at = now()
          WHERE id = $1`,
        [
          id,
          input.position ?? null,
          input.hiredAt !== undefined,
          input.hiredAt ?? null,
        ],
      );
    }
    if (input.roles !== undefined) {
      await replaceRoles(client, tenantId, userId, input.roles);
    }
    return loadOne(client, id);
  });
}

export function setAccessStatus(
  tenantId: string,
  id: string,
  userId: string,
  status: EmployeeAccessStatus,
): Promise<Employee> {
  return withTenant(tenantId, async (client) => {
    await client.query(
      "UPDATE employees SET access_status = $2, updated_at = now() WHERE id = $1",
      [id, status],
    );
    await client.query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1", [
      userId,
      userStatusFor(status),
    ]);
    return loadOne(client, id);
  });
}

/** Recarrega um funcionário dentro da transação corrente (pós-escrita). */
async function loadOne(client: PoolClient, id: string): Promise<Employee> {
  const { rows } = await client.query<Row>(
    `${SELECT_EMPLOYEE} WHERE e.id = $1 GROUP BY e.id, u.email, u.full_name, u.status`,
    [id],
  );
  return toEmployee(rows[0]!);
}
