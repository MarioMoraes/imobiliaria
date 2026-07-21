import { withTenant } from "../../shared/db.js";
import type { PoolClient } from "pg";
import type {
  AddInteractionInput,
  CreatePersonInput,
  Interaction,
  Person,
  PersonAddress,
  SearchProfile,
  SearchProfileInput,
  UpdatePersonInput,
} from "./person.schema.js";

/**
 * Acesso a dados de Pessoas. Tudo passa por `withTenant` (RLS): um tenant nunca
 * enxerga/edita pessoas de outro. A listagem traz a ficha-base + o perfil de
 * busca primário (LATERAL, sem N+1); o detalhe carrega endereços + perfis +
 * interações (append-only).
 */

interface Row {
  id: string;
  tenant_id: string;
  roles: string[];
  person_type: string;
  full_name: string;
  cpf_cnpj: string | null;
  rg: string | null;
  rg_issuer: string | null;
  gender: string | null;
  birth_date: Date | null;
  marital_status: string | null;
  nationality: string | null;
  occupation: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  bank: string | null;
  agency: string | null;
  account: string | null;
  holder_name: string | null;
  payment_authorization: string | null;
  spouse_name: string | null;
  spouse_cpf: string | null;
  spouse_rg: string | null;
  spouse_occupation: string | null;
  spouse_birth_date: Date | null;
  notes: string | null;
  references_txt: string | null;
  stage: string;
  source: string;
  assigned_broker_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface AddrRow {
  id: string;
  person_id: string;
  kind: string;
  street: string | null;
  number: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  mobile: string | null;
  fax: string | null;
  email: string | null;
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

function toAddress(a: AddrRow): PersonAddress {
  return {
    id: a.id,
    kind: a.kind as "RESIDENCIAL" | "COMERCIAL",
    street: a.street ?? undefined,
    number: a.number ?? undefined,
    district: a.district ?? undefined,
    city: a.city ?? undefined,
    state: a.state ?? undefined,
    zip: a.zip ?? undefined,
    phone: a.phone ?? undefined,
    mobile: a.mobile ?? undefined,
    fax: a.fax ?? undefined,
    email: a.email ?? undefined,
  };
}

function toPerson(
  row: Row,
  addresses: PersonAddress[],
  profiles: SearchProfile[],
  interactions: Interaction[],
): Person {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    roles: row.roles,
    personType: row.person_type,
    fullName: row.full_name,
    cpfCnpj: row.cpf_cnpj,
    rg: row.rg,
    rgIssuer: row.rg_issuer,
    gender: row.gender,
    birthDate: row.birth_date ? row.birth_date.toISOString().slice(0, 10) : null,
    maritalStatus: row.marital_status,
    nationality: row.nationality,
    occupation: row.occupation,
    email: row.email,
    phone: row.phone,
    mobile: row.mobile,
    bank: row.bank,
    agency: row.agency,
    account: row.account,
    holderName: row.holder_name,
    paymentAuthorization: row.payment_authorization,
    spouseName: row.spouse_name,
    spouseCpf: row.spouse_cpf,
    spouseRg: row.spouse_rg,
    spouseOccupation: row.spouse_occupation,
    spouseBirthDate: row.spouse_birth_date ? row.spouse_birth_date.toISOString().slice(0, 10) : null,
    notes: row.notes,
    references: row.references_txt,
    stage: row.stage as Person["stage"],
    source: row.source,
    assignedBrokerId: row.assigned_broker_id,
    status: row.status,
    addresses,
    searchProfiles: profiles,
    interactions,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadAddresses(client: PoolClient, personId: string): Promise<PersonAddress[]> {
  const { rows } = await client.query<AddrRow>(
    "SELECT * FROM person_addresses WHERE person_id = $1 ORDER BY kind",
    [personId],
  );
  return rows.map(toAddress);
}

async function loadProfiles(client: PoolClient, personId: string): Promise<SearchProfile[]> {
  const { rows } = await client.query<ProfileRow>(
    "SELECT * FROM person_search_profiles WHERE person_id = $1 ORDER BY created_at",
    [personId],
  );
  return rows.map(toProfile);
}

async function loadInteractions(client: PoolClient, personId: string): Promise<Interaction[]> {
  const { rows } = await client.query<InteractionRow>(
    "SELECT * FROM person_interactions WHERE person_id = $1 ORDER BY created_at DESC",
    [personId],
  );
  return rows.map(toInteraction);
}

async function loadOne(client: PoolClient, id: string): Promise<Person> {
  const { rows } = await client.query<Row>("SELECT * FROM persons WHERE id = $1", [id]);
  const [addresses, profiles, interactions] = await Promise.all([
    loadAddresses(client, id),
    loadProfiles(client, id),
    loadInteractions(client, id),
  ]);
  return toPerson(rows[0]!, addresses, profiles, interactions);
}

export function listPersons(
  tenantId: string,
  filters: { role?: string; stage?: string; brokerId?: string; includeInactive?: boolean } = {},
): Promise<Person[]> {
  return withTenant(tenantId, async (client) => {
    // Inativados (soft delete) ficam fora por padrão — a remoção pela UI marca
    // status = 'inactive' em vez de apagar a ficha (histórico de contratos).
    const conds: string[] = filters.includeInactive ? [] : ["p.status <> 'inactive'"];
    const params: unknown[] = [];
    if (filters.role) {
      params.push(filters.role);
      conds.push(`$${params.length} = ANY(p.roles)`);
    }
    if (filters.stage) {
      params.push(filters.stage);
      conds.push(`p.stage = $${params.length}`);
    }
    if (filters.brokerId) {
      params.push(filters.brokerId);
      conds.push(`p.assigned_broker_id = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    // Ficha-base + perfil de busca PRIMÁRIO (o mais antigo) via LATERAL — evita
    // N+1 e dá à UI a intenção/orçamento sem abrir o detalhe. Endereços e a
    // timeline de interações ficam só no detalhe (findPerson).
    const { rows } = await client.query<Row & { sp: ProfileRow | null }>(
      `SELECT p.*, CASE WHEN s.id IS NULL THEN NULL ELSE to_jsonb(s) END AS sp
         FROM persons p
         LEFT JOIN LATERAL (
           SELECT * FROM person_search_profiles psp
            WHERE psp.person_id = p.id ORDER BY psp.created_at LIMIT 1
         ) s ON true
         ${where}
        ORDER BY p.created_at DESC LIMIT 200`,
      params,
    );
    return rows.map((r) => {
      const profiles: SearchProfile[] = r.sp
        ? [toProfile({ ...r.sp, created_at: new Date(r.sp.created_at) })]
        : [];
      return toPerson(r, [], profiles, []);
    });
  });
}

export function findPerson(tenantId: string, id: string): Promise<Person | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM persons WHERE id = $1",
      [id],
    );
    if (!rows[0]) return null;
    return loadOne(client, id);
  });
}

/**
 * Deduplicação (MOD-CLIENTE-04): procura pessoa já existente por QUALQUER
 * documento/contato fornecido (CPF-CNPJ/telefone/email), escopado por RLS.
 */
export function findDuplicate(
  tenantId: string,
  contacts: { cpfCnpj?: string; phone?: string; email?: string },
): Promise<{ id: string } | null> {
  return withTenant(tenantId, async (client) => {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (contacts.cpfCnpj) {
      params.push(contacts.cpfCnpj);
      conds.push(`cpf_cnpj = $${params.length}`);
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
      `SELECT id FROM persons WHERE ${conds.join(" OR ")} LIMIT 1`,
      params,
    );
    return rows[0] ?? null;
  });
}

async function insertAddressRow(
  client: PoolClient,
  tenantId: string,
  personId: string,
  a: {
    kind: string;
    street?: string;
    number?: string;
    district?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
    mobile?: string;
    fax?: string;
    email?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO person_addresses
       (tenant_id, person_id, kind, street, number, district, city, state, zip,
        phone, mobile, fax, email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      tenantId,
      personId,
      a.kind,
      a.street ?? null,
      a.number ?? null,
      a.district ?? null,
      a.city ?? null,
      a.state ?? null,
      a.zip ?? null,
      a.phone ?? null,
      a.mobile ?? null,
      a.fax ?? null,
      a.email ?? null,
    ],
  );
}

async function insertProfileRow(
  client: PoolClient,
  tenantId: string,
  personId: string,
  p: SearchProfileInput,
): Promise<void> {
  await client.query(
    `INSERT INTO person_search_profiles
       (tenant_id, person_id, intent, min_price_cents, max_price_cents,
        property_types, districts, bedrooms_min, parking_min)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      tenantId,
      personId,
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

export function insertPerson(tenantId: string, input: CreatePersonInput): Promise<Person> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO persons
         (tenant_id, roles, person_type, full_name, cpf_cnpj, rg, rg_issuer, gender,
          birth_date, marital_status, nationality, occupation, email, phone, mobile,
          bank, agency, account, holder_name, payment_authorization, spouse_name,
          spouse_cpf, spouse_rg, spouse_occupation, spouse_birth_date, notes,
          references_txt, source, assigned_broker_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
       RETURNING id`,
      [
        tenantId,
        input.roles,
        input.personType,
        input.fullName,
        input.cpfCnpj ?? null,
        input.rg ?? null,
        input.rgIssuer ?? null,
        input.gender ?? null,
        input.birthDate ?? null,
        input.maritalStatus ?? null,
        input.nationality ?? null,
        input.occupation ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.mobile ?? null,
        input.bank ?? null,
        input.agency ?? null,
        input.account ?? null,
        input.holderName ?? null,
        input.paymentAuthorization ?? null,
        input.spouseName ?? null,
        input.spouseCpf ?? null,
        input.spouseRg ?? null,
        input.spouseOccupation ?? null,
        input.spouseBirthDate ?? null,
        input.notes ?? null,
        input.references ?? null,
        input.source,
        input.assignedBrokerId ?? null,
      ],
    );
    const id = rows[0]!.id;
    for (const a of input.addresses) await insertAddressRow(client, tenantId, id, a);
    if (input.searchProfile) await insertProfileRow(client, tenantId, id, input.searchProfile);
    return loadOne(client, id);
  });
}

const COLUMN: Record<string, string> = {
  roles: "roles",
  personType: "person_type",
  fullName: "full_name",
  cpfCnpj: "cpf_cnpj",
  rg: "rg",
  rgIssuer: "rg_issuer",
  gender: "gender",
  birthDate: "birth_date",
  maritalStatus: "marital_status",
  nationality: "nationality",
  occupation: "occupation",
  email: "email",
  phone: "phone",
  mobile: "mobile",
  bank: "bank",
  agency: "agency",
  account: "account",
  holderName: "holder_name",
  paymentAuthorization: "payment_authorization",
  spouseName: "spouse_name",
  spouseCpf: "spouse_cpf",
  spouseRg: "spouse_rg",
  spouseOccupation: "spouse_occupation",
  spouseBirthDate: "spouse_birth_date",
  notes: "notes",
  references: "references_txt",
  stage: "stage",
  assignedBrokerId: "assigned_broker_id",
};

export function updatePerson(
  tenantId: string,
  id: string,
  input: UpdatePersonInput,
): Promise<Person> {
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
        `UPDATE persons SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`,
        params,
      );
    }
    return loadOne(client, id);
  });
}

/**
 * Grava o endereço de um tipo (RESIDENCIAL/COMERCIAL). É um upsert por `kind`:
 * a pessoa tem no máximo um endereço de cada tipo, então reenviar o bloco pela
 * edição substitui o anterior em vez de duplicar.
 */
export function insertAddress(
  tenantId: string,
  personId: string,
  input: PersonAddress | { kind: string; street?: string; number?: string; district?: string; city?: string; state?: string; zip?: string },
): Promise<Person> {
  return withTenant(tenantId, async (client) => {
    await client.query("DELETE FROM person_addresses WHERE person_id = $1 AND kind = $2", [
      personId,
      input.kind,
    ]);
    await insertAddressRow(client, tenantId, personId, input);
    return loadOne(client, personId);
  });
}

/** Soft delete: marca a ficha como inativa (some das listas, preserva histórico). */
export function setStatus(tenantId: string, id: string, status: string): Promise<Person> {
  return withTenant(tenantId, async (client) => {
    await client.query("UPDATE persons SET status = $2, updated_at = now() WHERE id = $1", [
      id,
      status,
    ]);
    return loadOne(client, id);
  });
}

/**
 * Grava o perfil de busca. Upsert por `intent`: a UI mantém um perfil por
 * intenção (compra/locação), então reenviar pela edição substitui o anterior.
 */
export function insertSearchProfile(
  tenantId: string,
  personId: string,
  input: SearchProfileInput,
): Promise<Person> {
  return withTenant(tenantId, async (client) => {
    await client.query(
      "DELETE FROM person_search_profiles WHERE person_id = $1 AND intent = $2",
      [personId, input.intent],
    );
    await insertProfileRow(client, tenantId, personId, input);
    return loadOne(client, personId);
  });
}

export function insertInteraction(
  tenantId: string,
  personId: string,
  input: AddInteractionInput,
): Promise<Person> {
  return withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO person_interactions (tenant_id, person_id, channel, actor, summary, payload)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, personId, input.channel, input.actor, input.summary, input.payload ?? null],
    );
    return loadOne(client, personId);
  });
}

/**
 * Busca livre para a barra global: nome, CPF/CNPJ, e-mail e telefones. Os
 * documentos/telefones são comparados só por dígitos, então "123.456" acha o
 * CPF gravado sem pontuação (e vice-versa).
 */
export async function searchPersons(
  tenantId: string,
  term: string,
  limit = 5,
): Promise<Person[]> {
  const digits = term.replace(/\D/g, "");
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT * FROM persons p
        WHERE p.status <> 'inactive'
          AND (
            lower(p.full_name) LIKE lower($1)
            OR lower(coalesce(p.email, '')) LIKE lower($1)
            OR ($2 <> '' AND regexp_replace(coalesce(p.cpf_cnpj, ''), '\\D', '', 'g') LIKE $3)
            OR ($2 <> '' AND regexp_replace(coalesce(p.phone, ''),    '\\D', '', 'g') LIKE $3)
            OR ($2 <> '' AND regexp_replace(coalesce(p.mobile, ''),   '\\D', '', 'g') LIKE $3)
          )
        ORDER BY p.full_name
        LIMIT $4`,
      [`%${term}%`, digits, `%${digits}%`, limit],
    );
    return rows.map((r) => toPerson(r, [], [], []));
  });
}
