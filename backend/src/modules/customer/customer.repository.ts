import { withTenant } from "../../shared/db.js";
import type { PoolClient } from "pg";
import type {
  AddInteractionInput,
  CreateCustomerInput,
  Customer,
  Interaction,
  SearchProfile,
  SearchProfileInput,
  UpdateCustomerInput,
} from "./customer.schema.js";

/**
 * Acesso a dados de clientes. Tudo passa por `withTenant` (RLS): um tenant nunca
 * enxerga/edita clientes de outro. `customers` + perfis de busca + interações
 * (append-only) são carregados juntos no detalhe; a listagem traz só a ficha-base.
 */

interface Row {
  id: string;
  tenant_id: string;
  full_name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
  source: string;
  assigned_broker_id: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ProfileRow {
  id: string;
  intent: string;
  min_price_cents: string | null;
  max_price_cents: string | null;
  property_types: string[];
  districts: string[];
  bedrooms_min: number | null;
  parking_min: number | null;
  created_at: Date;
}

interface InteractionRow {
  id: string;
  channel: string;
  actor: string;
  summary: string;
  payload: unknown;
  created_at: Date;
}

function toProfile(r: ProfileRow): SearchProfile {
  return {
    id: r.id,
    intent: r.intent,
    minPriceCents: r.min_price_cents !== null ? Number(r.min_price_cents) : null,
    maxPriceCents: r.max_price_cents !== null ? Number(r.max_price_cents) : null,
    propertyTypes: r.property_types,
    districts: r.districts,
    bedroomsMin: r.bedrooms_min,
    parkingMin: r.parking_min,
    createdAt: r.created_at.toISOString(),
  };
}

function toInteraction(r: InteractionRow): Interaction {
  return {
    id: r.id,
    channel: r.channel,
    actor: r.actor,
    summary: r.summary,
    payload: r.payload,
    createdAt: r.created_at.toISOString(),
  };
}

function toCustomer(row: Row, profiles: SearchProfile[], interactions: Interaction[]): Customer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    fullName: row.full_name,
    cpf: row.cpf,
    email: row.email,
    phone: row.phone,
    stage: row.stage as Customer["stage"],
    source: row.source,
    assignedBrokerId: row.assigned_broker_id,
    notes: row.notes,
    searchProfiles: profiles,
    interactions,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadProfiles(client: PoolClient, customerId: string): Promise<SearchProfile[]> {
  const { rows } = await client.query<ProfileRow>(
    "SELECT * FROM customer_search_profiles WHERE customer_id = $1 ORDER BY created_at",
    [customerId],
  );
  return rows.map(toProfile);
}

async function loadInteractions(client: PoolClient, customerId: string): Promise<Interaction[]> {
  const { rows } = await client.query<InteractionRow>(
    "SELECT * FROM customer_interactions WHERE customer_id = $1 ORDER BY created_at DESC",
    [customerId],
  );
  return rows.map(toInteraction);
}

async function loadOne(client: PoolClient, id: string): Promise<Customer> {
  const { rows } = await client.query<Row>("SELECT * FROM customers WHERE id = $1", [id]);
  const [profiles, interactions] = await Promise.all([
    loadProfiles(client, id),
    loadInteractions(client, id),
  ]);
  return toCustomer(rows[0]!, profiles, interactions);
}

export function listCustomers(
  tenantId: string,
  filters: { stage?: string; brokerId?: string } = {},
): Promise<Customer[]> {
  return withTenant(tenantId, async (client) => {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.stage) {
      params.push(filters.stage);
      conds.push(`c.stage = $${params.length}`);
    }
    if (filters.brokerId) {
      params.push(filters.brokerId);
      conds.push(`c.assigned_broker_id = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // Listagem traz a ficha-base + o perfil de busca PRIMÁRIO (o mais antigo),
    // via LATERAL — evita N+1 e dá à UI a intenção/orçamento sem abrir o detalhe.
    // A timeline de interações fica só no detalhe (find).
    const { rows } = await client.query<Row & { p: ProfileRow | null }>(
      `SELECT c.*, CASE WHEN p.id IS NULL THEN NULL ELSE to_jsonb(p) END AS p
         FROM customers c
         LEFT JOIN LATERAL (
           SELECT * FROM customer_search_profiles sp
            WHERE sp.customer_id = c.id ORDER BY sp.created_at LIMIT 1
         ) p ON true
         ${where}
        ORDER BY c.created_at DESC LIMIT 200`,
      params,
    );
    return rows.map((r) => {
      // to_jsonb devolve created_at como string ISO — normaliza para Date.
      const profiles: SearchProfile[] = r.p
        ? [toProfile({ ...r.p, created_at: new Date(r.p.created_at) })]
        : [];
      return toCustomer(r, profiles, []);
    });
  });
}

export function findCustomer(tenantId: string, id: string): Promise<Customer | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>("SELECT id FROM customers WHERE id = $1", [id]);
    if (!rows[0]) return null;
    return loadOne(client, id);
  });
}

/**
 * Deduplicação (MOD-CLIENTE-04): procura cliente já existente por QUALQUER
 * contato fornecido (CPF/telefone/email), escopado ao tenant via RLS.
 */
export function findDuplicate(
  tenantId: string,
  contacts: { cpf?: string; phone?: string; email?: string },
): Promise<{ id: string } | null> {
  return withTenant(tenantId, async (client) => {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (contacts.cpf) {
      params.push(contacts.cpf);
      conds.push(`cpf = $${params.length}`);
    }
    if (contacts.phone) {
      params.push(contacts.phone);
      conds.push(`phone = $${params.length}`);
    }
    if (contacts.email) {
      params.push(contacts.email);
      conds.push(`lower(email) = lower($${params.length})`);
    }
    if (conds.length === 0) return null;
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM customers WHERE ${conds.join(" OR ")} LIMIT 1`,
      params,
    );
    return rows[0] ?? null;
  });
}

async function insertProfileRow(
  client: PoolClient,
  tenantId: string,
  customerId: string,
  p: SearchProfileInput,
): Promise<void> {
  await client.query(
    `INSERT INTO customer_search_profiles
       (tenant_id, customer_id, intent, min_price_cents, max_price_cents,
        property_types, districts, bedrooms_min, parking_min)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      tenantId,
      customerId,
      p.intent,
      p.minPriceCents ?? null,
      p.maxPriceCents ?? null,
      p.propertyTypes,
      p.districts,
      p.bedroomsMin ?? null,
      p.parkingMin ?? null,
    ],
  );
}

export function insertCustomer(tenantId: string, input: CreateCustomerInput): Promise<Customer> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO customers
         (tenant_id, full_name, cpf, email, phone, source, assigned_broker_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        tenantId,
        input.fullName,
        input.cpf ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.source,
        input.assignedBrokerId ?? null,
        input.notes ?? null,
      ],
    );
    const id = rows[0]!.id;
    if (input.searchProfile) await insertProfileRow(client, tenantId, id, input.searchProfile);
    return loadOne(client, id);
  });
}

const COLUMN: Record<string, string> = {
  fullName: "full_name",
  email: "email",
  phone: "phone",
  stage: "stage",
  assignedBrokerId: "assigned_broker_id",
  notes: "notes",
};

export function updateCustomer(
  tenantId: string,
  id: string,
  input: UpdateCustomerInput,
): Promise<Customer> {
  return withTenant(tenantId, async (client) => {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, col] of Object.entries(COLUMN)) {
      if (key in input) {
        params.push((input as Record<string, unknown>)[key] ?? null);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length > 0) {
      await client.query(
        `UPDATE customers SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`,
        params,
      );
    }
    return loadOne(client, id);
  });
}

export function insertSearchProfile(
  tenantId: string,
  customerId: string,
  input: SearchProfileInput,
): Promise<Customer> {
  return withTenant(tenantId, async (client) => {
    await insertProfileRow(client, tenantId, customerId, input);
    return loadOne(client, customerId);
  });
}

export function insertInteraction(
  tenantId: string,
  customerId: string,
  input: AddInteractionInput,
): Promise<Customer> {
  return withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO customer_interactions (tenant_id, customer_id, channel, actor, summary, payload)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, customerId, input.channel, input.actor, input.summary, input.payload ?? null],
    );
    return loadOne(client, customerId);
  });
}
