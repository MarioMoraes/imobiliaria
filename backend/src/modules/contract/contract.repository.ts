import { withTenant } from "../../shared/db.js";
import type { PoolClient } from "pg";
import type {
  Contract,
  ContractParty,
  ContractTemplate,
  CreateContractInput,
  UpdateContractInput,
} from "./contract.schema.js";

/**
 * Acesso a dados de contratos. Toda operação roda dentro de `withTenant`, então
 * o RLS garante que só linhas do tenant corrente são visíveis — mesmo quando o
 * SQL não filtra explicitamente por tenant_id.
 */

interface Row {
  id: string;
  tenant_id: string;
  code: number | null;
  property_id: string | null;
  template_id: string | null;
  status: string;

  starts_at: string | null; // castado p/ text no SELECT (evita shift de fuso)
  ends_at: string | null;
  term_months: number | null;
  readjust_index: string;
  readjust_period_months: number | null;
  last_readjust_at: string | null;
  owner_pay_day: number | null;
  tenant_pay_day: number | null;
  terminated_at: string | null;

  rental_value_cents: string | null;
  interest_percent: string | null;
  penalty_percent: string | null;
  admin_fee_percent: string | null;
  is_administration: boolean;
  income_tax_declaration: boolean;
  iptu_charged_to: string | null;
  commission_type: string | null;
  has_commission: boolean;

  guarantee_kind: string | null;
  has_insurance: boolean;
  insurance_description: string | null;
  insurance_value_cents: string | null;

  is_settled: boolean;
  has_eviction_order: boolean;
  has_judicial_execution: boolean;
  process_number: string | null;
  court: string | null;

  special_clauses: string | null;
  guarantor_property_info: string | null;

  parties: ContractParty[] | null;
  latest_version: number | null;
  created_at: Date;
  updated_at: Date;
}

/** BIGINT/NUMERIC chegam como string no pg; converte preservando null. */
const num = (v: string | null): number | null => (v === null ? null : Number(v));

/**
 * Mapa dos campos editáveis (input camelCase → coluna snake_case). Fonte única
 * do INSERT e do UPDATE dinâmicos. `code`, `id`, timestamps, partes e versões
 * ficam de fora (não vêm do input).
 */
const COLUMN = {
  propertyId: "property_id",
  templateId: "template_id",
  status: "status",

  startsAt: "starts_at",
  endsAt: "ends_at",
  termMonths: "term_months",
  readjustIndex: "readjust_index",
  readjustPeriodMonths: "readjust_period_months",
  lastReadjustAt: "last_readjust_at",
  ownerPayDay: "owner_pay_day",
  tenantPayDay: "tenant_pay_day",
  terminatedAt: "terminated_at",

  rentalValueCents: "rental_value_cents",
  interestPercent: "interest_percent",
  penaltyPercent: "penalty_percent",
  adminFeePercent: "admin_fee_percent",
  isAdministration: "is_administration",
  incomeTaxDeclaration: "income_tax_declaration",
  iptuChargedTo: "iptu_charged_to",
  commissionType: "commission_type",
  hasCommission: "has_commission",

  guaranteeKind: "guarantee_kind",
  hasInsurance: "has_insurance",
  insuranceDescription: "insurance_description",
  insuranceValueCents: "insurance_value_cents",

  isSettled: "is_settled",
  hasEvictionOrder: "has_eviction_order",
  hasJudicialExecution: "has_judicial_execution",
  processNumber: "process_number",
  court: "court",

  specialClauses: "special_clauses",
  guarantorPropertyInfo: "guarantor_property_info",
} as const;

type ColumnKey = keyof typeof COLUMN;

// Agrega as partes (contract_parties ⋈ persons) como jsonb — sem N+1.
const PARTIES_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', cp.id, 'contractId', cp.contract_id, 'role', cp.role,
      'personId', cp.person_id, 'personName', pe.full_name,
      'signedAt', cp.signed_at
    ) ORDER BY cp.role, pe.full_name) AS parties
    FROM contract_parties cp JOIN persons pe ON pe.id = cp.person_id
    WHERE cp.contract_id = c.id
  ) pt ON true`;

// Última versão gerada (para saber se há PDF disponível).
const VERSION_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT MAX(version) AS latest_version
    FROM contract_versions cv WHERE cv.contract_id = c.id
  ) v ON true`;

// Colunas DATE cast para text (evita que o parser do pg desloque o dia por fuso).
const DATE_CASTS = `
  c.starts_at::text AS starts_at, c.ends_at::text AS ends_at,
  c.last_readjust_at::text AS last_readjust_at, c.terminated_at::text AS terminated_at`;
const SELECT_COLS = `c.*, ${DATE_CASTS}, pt.parties, v.latest_version`;

function toContract(row: Row): Contract {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    propertyId: row.property_id,
    templateId: row.template_id,
    status: row.status,

    startsAt: row.starts_at,
    endsAt: row.ends_at,
    termMonths: row.term_months,
    readjustIndex: row.readjust_index,
    readjustPeriodMonths: row.readjust_period_months,
    lastReadjustAt: row.last_readjust_at,
    ownerPayDay: row.owner_pay_day,
    tenantPayDay: row.tenant_pay_day,
    terminatedAt: row.terminated_at,

    rentalValueCents: num(row.rental_value_cents),
    interestPercent: num(row.interest_percent),
    penaltyPercent: num(row.penalty_percent),
    adminFeePercent: num(row.admin_fee_percent),
    isAdministration: row.is_administration,
    incomeTaxDeclaration: row.income_tax_declaration,
    iptuChargedTo: row.iptu_charged_to,
    commissionType: row.commission_type,
    hasCommission: row.has_commission,

    guaranteeKind: row.guarantee_kind,
    hasInsurance: row.has_insurance,
    insuranceDescription: row.insurance_description,
    insuranceValueCents: num(row.insurance_value_cents),

    isSettled: row.is_settled,
    hasEvictionOrder: row.has_eviction_order,
    hasJudicialExecution: row.has_judicial_execution,
    processNumber: row.process_number,
    court: row.court,

    specialClauses: row.special_clauses,
    guarantorPropertyInfo: row.guarantor_property_info,

    parties: row.parties ?? [],
    latestVersion: row.latest_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadContract(client: PoolClient, id: string): Promise<Contract> {
  const { rows } = await client.query<Row>(
    `SELECT ${SELECT_COLS} FROM contracts c ${PARTIES_LATERAL} ${VERSION_LATERAL} WHERE c.id = $1`,
    [id],
  );
  return toContract(rows[0]!);
}

export async function listContracts(tenantId: string): Promise<Contract[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT ${SELECT_COLS} FROM contracts c ${PARTIES_LATERAL} ${VERSION_LATERAL}
        ORDER BY c.created_at DESC LIMIT 100`,
    );
    return rows.map(toContract);
  });
}

export async function findContract(tenantId: string, id: string): Promise<Contract | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM contracts WHERE id = $1",
      [id],
    );
    return rows[0] ? loadContract(client, id) : null;
  });
}

export async function insertContract(
  tenantId: string,
  input: CreateContractInput,
): Promise<Contract> {
  return withTenant(tenantId, async (client) => {
    // Código sequencial por tenant (RLS já escopa o MAX ao tenant corrente).
    const codeRes = await client.query<{ next: number }>(
      "SELECT COALESCE(MAX(code), 0) + 1 AS next FROM contracts",
    );
    const code = Number(codeRes.rows[0]!.next);

    const cols = ["tenant_id", "code"];
    const values: unknown[] = [tenantId, code];
    for (const [key, col] of Object.entries(COLUMN)) {
      cols.push(col);
      values.push((input as Record<string, unknown>)[key] ?? null);
    }
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO contracts (${cols.join(", ")}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
    return loadContract(client, rows[0]!.id);
  });
}

export async function updateContract(
  tenantId: string,
  id: string,
  input: UpdateContractInput,
): Promise<Contract | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(COLUMN)) {
    const value = (input as Record<string, unknown>)[key as ColumnKey];
    if (value !== undefined) {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    }
  }
  if (sets.length === 0) return findContract(tenantId, id);

  return withTenant(tenantId, async (client) => {
    values.push(id);
    const { rowCount } = await client.query(
      `UPDATE contracts SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
      values,
    );
    return (rowCount ?? 0) > 0 ? loadContract(client, id) : null;
  });
}

export async function deleteContract(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query("DELETE FROM contracts WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  });
}

/* ---------------------------------------------------------- Partes */

/** Vincula uma parte ao contrato. Idempotente por (contract, role, person). */
export async function addParty(
  tenantId: string,
  contractId: string,
  role: string,
  personId: string,
): Promise<Contract> {
  return withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO contract_parties (tenant_id, contract_id, role, person_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (contract_id, role, person_id) DO NOTHING`,
      [tenantId, contractId, role, personId],
    );
    return loadContract(client, contractId);
  });
}

export async function removeParty(
  tenantId: string,
  contractId: string,
  partyId: string,
): Promise<Contract> {
  return withTenant(tenantId, async (client) => {
    await client.query(
      "DELETE FROM contract_parties WHERE id = $1 AND contract_id = $2",
      [partyId, contractId],
    );
    return loadContract(client, contractId);
  });
}

/* ------------------------------------------------------- Templates */

interface TemplateRow {
  id: string;
  name: string;
  content: string;
  variables: string[];
  active: boolean;
}

const toTemplate = (r: TemplateRow): ContractTemplate => ({
  id: r.id,
  name: r.name,
  content: r.content,
  variables: r.variables ?? [],
  active: r.active,
});

/**
 * Templates do tenant. Por padrão só os ativos (é o que o seletor de contrato
 * deve oferecer); a tela de manutenção pede `includeInactive` para editá-los.
 */
export async function listTemplates(
  tenantId: string,
  includeInactive = false,
): Promise<ContractTemplate[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<TemplateRow>(
      `SELECT id, name, html AS content, variables, active FROM contract_templates
        ${includeInactive ? "" : "WHERE active"}
        ORDER BY name`,
    );
    return rows.map(toTemplate);
  });
}

export async function insertTemplate(
  tenantId: string,
  input: { name: string; content: string; active: boolean; variables: string[] },
): Promise<ContractTemplate> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<TemplateRow>(
      `INSERT INTO contract_templates (tenant_id, name, html, variables, active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, html AS content, variables, active`,
      [tenantId, input.name, input.content, input.variables, input.active],
    );
    return toTemplate(rows[0]!);
  });
}

/**
 * Atualização parcial. `variables` acompanha o HTML: só é reescrita quando o
 * HTML muda (o service a deriva do documento).
 */
export async function updateTemplate(
  tenantId: string,
  id: string,
  input: { name?: string; content?: string; active?: boolean; variables?: string[] },
): Promise<ContractTemplate | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, value: unknown) => {
    values.push(value);
    sets.push(`${col} = $${values.length}`);
  };

  if (input.name !== undefined) set("name", input.name);
  if (input.content !== undefined) set("html", input.content);
  if (input.active !== undefined) set("active", input.active);
  if (input.variables !== undefined) set("variables", input.variables);
  if (sets.length === 0) return findTemplateById(tenantId, id);

  values.push(id);
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<TemplateRow>(
      `UPDATE contract_templates SET ${sets.join(", ")}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING id, name, html AS content, variables, active`,
      values,
    );
    return rows[0] ? toTemplate(rows[0]) : null;
  });
}

export async function findTemplateById(
  tenantId: string,
  id: string,
): Promise<ContractTemplate | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<TemplateRow>(
      "SELECT id, name, html AS content, variables, active FROM contract_templates WHERE id = $1",
      [id],
    );
    return rows[0] ? toTemplate(rows[0]) : null;
  });
}

/** Remove um template. Retorna true se algo foi removido. */
export async function deleteTemplate(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      "DELETE FROM contract_templates WHERE id = $1",
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}

/** Quantos contratos apontam para este template (bloqueia a remoção). */
export async function countContractsUsingTemplate(
  tenantId: string,
  id: string,
): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM contracts WHERE template_id = $1",
      [id],
    );
    return Number(rows[0]!.count);
  });
}

/** Template por id, ou o primeiro template ativo do tenant se `id` for nulo. */
export async function findTemplate(
  tenantId: string,
  id: string | null,
): Promise<ContractTemplate | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = id
      ? await client.query<TemplateRow>(
          "SELECT id, name, html AS content, variables, active FROM contract_templates WHERE id = $1",
          [id],
        )
      : await client.query<TemplateRow>(
          "SELECT id, name, html AS content, variables, active FROM contract_templates WHERE active ORDER BY created_at LIMIT 1",
        );
    return rows[0] ? toTemplate(rows[0]) : null;
  });
}

/* -------------------------------------------------------- Versões */

/** Grava uma nova versão (imutável) com a chave do PDF. version = MAX+1. */
export async function insertVersion(
  tenantId: string,
  contractId: string,
  pdfStorageKey: string,
  snapshot: unknown,
): Promise<{ version: number; pdfStorageKey: string }> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ version: number }>(
      `INSERT INTO contract_versions (tenant_id, contract_id, version, snapshot_json, pdf_storage_key)
       VALUES ($1, $2,
         (SELECT COALESCE(MAX(version), 0) + 1 FROM contract_versions WHERE contract_id = $2),
         $3, $4)
       RETURNING version`,
      [tenantId, contractId, JSON.stringify(snapshot), pdfStorageKey],
    );
    return { version: Number(rows[0]!.version), pdfStorageKey };
  });
}

/** Chave do PDF da versão mais recente (ou null se ainda não gerado). */
export async function findLatestVersionKey(
  tenantId: string,
  contractId: string,
): Promise<string | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ pdf_storage_key: string | null }>(
      `SELECT pdf_storage_key FROM contract_versions
        WHERE contract_id = $1 ORDER BY version DESC LIMIT 1`,
      [contractId],
    );
    return rows[0]?.pdf_storage_key ?? null;
  });
}
