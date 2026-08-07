import type pg from "pg";
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
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Colunas do banco + o saldo DERIVADO dos lançamentos manuais da conta.
 *
 * A lista é explícita (e não `b.*`) justamente para deixar `banks.balance_cents`
 * de fora: a coluna nunca chegou a ser alimentada, e mantê-la no SELECT ao lado
 * do alias criaria dois `balance_cents` na mesma linha — o driver ficaria com o
 * último, o que é acidente esperando acontecer. Ver o cabeçalho de
 * `bank.schema.ts` para o porquê de derivar.
 *
 * Os dois COALESCE são separados de propósito: `sum() FILTER` devolve NULL
 * quando nenhuma linha casa, e `entradas − NULL` é NULL — uma conta que só
 * recebeu entradas apareceria zerada.
 */
const BANK_COLS = `
  b.id, b.tenant_id, b.code, b.name, b.agency, b.account_number, b.favorite,
  b.active, b.created_at, b.updated_at,
  (SELECT COALESCE(sum(e.amount_cents) FILTER (WHERE e.direction = 'ENTRADA'), 0)
        - COALESCE(sum(e.amount_cents) FILTER (WHERE e.direction = 'SAIDA'),   0)
     FROM cash_flow_entries e
    WHERE e.bank_id = b.id) AS balance_cents`;

function toBank(row: Row): Bank {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    agency: row.agency,
    accountNumber: row.account_number,
    favorite: row.favorite,
    balanceCents: Number(row.balance_cents),
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listBanks(tenantId: string): Promise<Bank[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT ${BANK_COLS} FROM banks b ORDER BY b.favorite DESC, b.name ASC`,
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
      `SELECT ${BANK_COLS} FROM banks b WHERE b.id = $1`,
      [id],
    );
    return rows[0] ? toBank(rows[0]) : null;
  });
}

/**
 * Recarrega no formato canônico depois de escrever. O `RETURNING *` não serve
 * mais: o saldo é uma subconsulta, e devolvê-lo pelo caminho da escrita exigiria
 * repetir a expressão em dois lugares que iriam divergir.
 */
async function reload(client: pg.PoolClient, id: string): Promise<Bank | null> {
  const { rows } = await client.query<Row>(
    `SELECT ${BANK_COLS} FROM banks b WHERE b.id = $1`,
    [id],
  );
  return rows[0] ? toBank(rows[0]) : null;
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
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO banks (tenant_id, code, name, agency, account_number, favorite)
       VALUES ($1, (SELECT COALESCE(MAX(code), 0) + 1 FROM banks), $2, $3, $4, $5)
       RETURNING id`,
      [
        tenantId,
        input.name,
        input.agency ?? null,
        input.accountNumber ?? null,
        input.favorite,
      ],
    );
    return (await reload(client, rows[0]!.id))!;
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
    if (sets.length === 0) return reload(client, id);

    sets.push("updated_at = now()");
    values.push(id);
    const { rowCount } = await client.query(
      `UPDATE banks SET ${sets.join(", ")} WHERE id = $${values.length}`,
      values,
    );
    return (rowCount ?? 0) > 0 ? reload(client, id) : null;
  });
}

/** Remove um banco do tenant. Retorna true se algo foi removido. */
export async function deleteBank(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query("DELETE FROM banks WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  });
}
