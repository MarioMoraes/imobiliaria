import { withTenant } from "../../shared/db.js";
import type { PoolClient } from "pg";
import type { CreateGuarantorInput, Guarantor } from "./guarantor.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  person_type: string;
  cpf_cnpj: string;
  full_name: string;
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
  spouse_name: string | null;
  spouse_cpf: string | null;
  notes: string | null;
  references_txt: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface AddrRow {
  id: string;
  guarantor_id: string;
  kind: string;
  street: string | null;
  number: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

function toGuarantor(row: Row, addrs: AddrRow[]): Guarantor {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    personType: row.person_type,
    cpfCnpj: row.cpf_cnpj,
    fullName: row.full_name,
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
    spouseName: row.spouse_name,
    spouseCpf: row.spouse_cpf,
    notes: row.notes,
    references: row.references_txt,
    status: row.status,
    addresses: addrs
      .filter((a) => a.guarantor_id === row.id)
      .map((a) => ({
        id: a.id,
        kind: a.kind as "RESIDENCIAL" | "COMERCIAL",
        street: a.street ?? undefined,
        number: a.number ?? undefined,
        district: a.district ?? undefined,
        city: a.city ?? undefined,
        state: a.state ?? undefined,
        zip: a.zip ?? undefined,
      })),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadAddresses(
  client: PoolClient,
  guarantorIds: string[],
): Promise<AddrRow[]> {
  if (guarantorIds.length === 0) return [];
  const { rows } = await client.query<AddrRow>(
    "SELECT * FROM guarantor_addresses WHERE guarantor_id = ANY($1)",
    [guarantorIds],
  );
  return rows;
}

export async function listGuarantors(tenantId: string): Promise<Guarantor[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM guarantors ORDER BY created_at DESC LIMIT 200",
    );
    const addrs = await loadAddresses(
      client,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toGuarantor(r, addrs));
  });
}

export async function findGuarantor(
  tenantId: string,
  id: string,
): Promise<Guarantor | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM guarantors WHERE id = $1",
      [id],
    );
    if (!rows[0]) return null;
    const addrs = await loadAddresses(client, [rows[0].id]);
    return toGuarantor(rows[0], addrs);
  });
}

export async function findByDoc(
  tenantId: string,
  cpfCnpj: string,
): Promise<Guarantor | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM guarantors WHERE cpf_cnpj = $1",
      [cpfCnpj],
    );
    if (!rows[0]) return null;
    const addrs = await loadAddresses(client, [rows[0].id]);
    return toGuarantor(rows[0], addrs);
  });
}

export async function insertGuarantor(
  tenantId: string,
  input: CreateGuarantorInput,
): Promise<Guarantor> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `INSERT INTO guarantors
         (tenant_id, person_type, cpf_cnpj, full_name, rg, rg_issuer, gender, birth_date,
          marital_status, nationality, occupation, email, phone, mobile, bank, agency,
          account, holder_name, spouse_name, spouse_cpf, notes, references_txt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        tenantId,
        input.personType,
        input.cpfCnpj,
        input.fullName,
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
        input.spouseName ?? null,
        input.spouseCpf ?? null,
        input.notes ?? null,
        input.references ?? null,
      ],
    );
    const guarantor = rows[0]!;

    for (const a of input.addresses) {
      await client.query(
        `INSERT INTO guarantor_addresses
           (tenant_id, guarantor_id, kind, street, number, district, city, state, zip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          tenantId,
          guarantor.id,
          a.kind,
          a.street ?? null,
          a.number ?? null,
          a.district ?? null,
          a.city ?? null,
          a.state ?? null,
          a.zip ?? null,
        ],
      );
    }

    const addrs = await loadAddresses(client, [guarantor.id]);
    return toGuarantor(guarantor, addrs);
  });
}
