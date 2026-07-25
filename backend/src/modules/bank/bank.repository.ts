import { lockSequence, withTenant } from "../../shared/db.js";
import type { Bank, CreateBankInput, UpdateBankInput } from "./bank.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  code: number;
  name: string;
  agency: string | null;
  account_number: string | null;
  favorite: boolean;
  balance_cents: string; // BIGINT chega como string no pg
  vault_cents: string;
  in_transit_cents: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toBank(row: Row): Bank {
  const balanceCents = Number(row.balance_cents);
  const inTransitCents = Number(row.in_transit_cents);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    agency: row.agency,
    accountNumber: row.account_number,
    favorite: row.favorite,
    balanceCents,
    vaultCents: Number(row.vault_cents),
    inTransitCents,
    // Provável Saldo é calculado, não armazenado: Saldo + Em Trânsito.
    probableBalanceCents: balanceCents + inTransitCents,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listBanks(tenantId: string): Promise<Bank[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM banks ORDER BY favorite DESC, name ASC",
    );
    return rows.map(toBank);
  });
}

export async function findBankById(
  tenantId: string,
  id: string,
): Promise<Bank | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM banks WHERE id = $1",
      [id],
    );
    return rows[0] ? toBank(rows[0]) : null;
  });
}

export async function insertBank(
  tenantId: string,
  input: CreateBankInput,
): Promise<Bank> {
  return withTenant(tenantId, async (client) => {
    // Código auto-incremento por tenant: usa MAX(code)+1 do próprio tenant (a
    // subquery é escopada pela RLS). O lock serializa as inserções concorrentes
    // do MESMO tenant — a transação por si só não faz isso (ver `lockSequence`).
    await lockSequence(client, tenantId, "banks.code");
    const { rows } = await client.query<Row>(
      `INSERT INTO banks (tenant_id, code, name, agency, account_number, favorite)
       VALUES ($1, (SELECT COALESCE(MAX(code), 0) + 1 FROM banks), $2, $3, $4, $5)
       RETURNING *`,
      [
        tenantId,
        input.name,
        input.agency ?? null,
        input.accountNumber ?? null,
        input.favorite,
      ],
    );
    return toBank(rows[0]!);
  });
}

/**
 * Atualiza só os campos editáveis presentes em `input` (SET dinâmico). Os saldos
 * ficam de fora — são alimentados por outras rotinas. Retorna null se o banco não
 * existe no tenant.
 */
export async function updateBank(
  tenantId: string,
  id: string,
  input: UpdateBankInput,
): Promise<Bank | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, val: unknown) => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  // `code` não é editável: é a identidade sequencial do banco no tenant.
  if (input.name !== undefined) push("name", input.name);
  if (input.agency !== undefined) push("agency", input.agency ?? null);
  if (input.accountNumber !== undefined) push("account_number", input.accountNumber ?? null);
  if (input.favorite !== undefined) push("favorite", input.favorite);

  return withTenant(tenantId, async (client) => {
    if (sets.length === 0) {
      const { rows } = await client.query<Row>("SELECT * FROM banks WHERE id = $1", [id]);
      return rows[0] ? toBank(rows[0]) : null;
    }
    sets.push("updated_at = now()");
    values.push(id);
    const { rows } = await client.query<Row>(
      `UPDATE banks SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return rows[0] ? toBank(rows[0]) : null;
  });
}

/** Remove um banco do tenant. Retorna true se algo foi removido. */
export async function deleteBank(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query("DELETE FROM banks WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  });
}
