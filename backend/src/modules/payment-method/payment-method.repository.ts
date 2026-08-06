import { lockSequence, withTenant } from "../../shared/db.js";
import type {
  CreatePaymentMethodInput,
  PaymentMethod,
  UpdatePaymentMethodInput,
} from "./payment-method.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  code: number;
  name: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toPaymentMethod(row: Row): PaymentMethod {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listPaymentMethods(tenantId: string): Promise<PaymentMethod[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM payment_methods ORDER BY code ASC",
    );
    return rows.map(toPaymentMethod);
  });
}

export async function findPaymentMethodById(
  tenantId: string,
  id: string,
): Promise<PaymentMethod | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM payment_methods WHERE id = $1",
      [id],
    );
    return rows[0] ? toPaymentMethod(rows[0]) : null;
  });
}

export async function findByName(
  tenantId: string,
  name: string,
): Promise<PaymentMethod | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM payment_methods WHERE lower(name) = lower($1)",
      [name],
    );
    return rows[0] ? toPaymentMethod(rows[0]) : null;
  });
}

export async function insertPaymentMethod(
  tenantId: string,
  input: CreatePaymentMethodInput,
): Promise<PaymentMethod> {
  return withTenant(tenantId, async (client) => {
    // Código sequencial por tenant: MAX(code)+1 numa subquery escopada pela RLS.
    // O lock serializa as inserções concorrentes do MESMO tenant (ver `lockSequence`).
    await lockSequence(client, tenantId, "payment_methods.code");
    const { rows } = await client.query<Row>(
      `INSERT INTO payment_methods (tenant_id, code, name)
       VALUES ($1, (SELECT COALESCE(MAX(code), 0) + 1 FROM payment_methods), $2)
       RETURNING *`,
      [tenantId, input.name],
    );
    return toPaymentMethod(rows[0]!);
  });
}

/** Atualiza só o que veio em `input`. Retorna null se a forma não existe no tenant. */
export async function updatePaymentMethod(
  tenantId: string,
  id: string,
  input: UpdatePaymentMethodInput,
): Promise<PaymentMethod | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, val: unknown) => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  // `code` não é editável: é a identidade sequencial da forma no tenant.
  if (input.name !== undefined) push("name", input.name);
  if (input.active !== undefined) push("active", input.active);

  return withTenant(tenantId, async (client) => {
    if (sets.length === 0) {
      const { rows } = await client.query<Row>(
        "SELECT * FROM payment_methods WHERE id = $1",
        [id],
      );
      return rows[0] ? toPaymentMethod(rows[0]) : null;
    }
    sets.push("updated_at = now()");
    values.push(id);
    const { rows } = await client.query<Row>(
      `UPDATE payment_methods SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return rows[0] ? toPaymentMethod(rows[0]) : null;
  });
}

/** Remove uma forma de pagamento. Retorna true se algo foi removido. */
export async function deletePaymentMethod(
  tenantId: string,
  id: string,
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      "DELETE FROM payment_methods WHERE id = $1",
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}
