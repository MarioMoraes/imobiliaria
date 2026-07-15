import { withTenant } from "../../shared/db.js";
import type { Event, CreateEventInput, EventKind } from "./event.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  kind: string;
  interest_percent: string; // NUMERIC chega como string no pg
  judicial_interest_percent: string;
  penalty_percent: string;
  applies_admin_fee: boolean;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

function toEvent(row: Row): Event {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    kind: row.kind as EventKind,
    interestPercent: Number(row.interest_percent),
    judicialInterestPercent: Number(row.judicial_interest_percent),
    penaltyPercent: Number(row.penalty_percent),
    appliesAdminFee: row.applies_admin_fee,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listEvents(tenantId: string): Promise<Event[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM events ORDER BY name ASC",
    );
    return rows.map(toEvent);
  });
}

export async function findByName(
  tenantId: string,
  name: string,
): Promise<Event | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM events WHERE lower(name) = lower($1)",
      [name],
    );
    return rows[0] ? toEvent(rows[0]) : null;
  });
}

export async function insertEvent(
  tenantId: string,
  input: CreateEventInput,
): Promise<Event> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO events
         (tenant_id, name, kind, interest_percent, judicial_interest_percent,
          penalty_percent, applies_admin_fee)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        input.name,
        input.kind,
        input.interestPercent,
        input.judicialInterestPercent,
        input.penaltyPercent,
        input.appliesAdminFee,
      ],
    );
    return toEvent(rows[0]!);
  });
}

/** Remove um evento do tenant. Retorna true se algo foi removido. */
export async function deleteEvent(
  tenantId: string,
  id: string,
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      "DELETE FROM events WHERE id = $1",
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}
