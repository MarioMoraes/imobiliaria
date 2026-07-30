import { withPlatform, withTenant } from "../../shared/db.js";
import type {
  AuditEntry,
  AuditLog,
  AuditPage,
  AuditQuery,
  AuditStatus,
  AuditSummary,
  GlobalAuditQuery,
} from "./audit.schema.js";
import { SENSITIVE_ACTIONS } from "./audit.actions.js";

/**
 * Acesso à trilha de auditoria. Segue o padrão de sufixo de
 * `tenant.repository.ts`:
 *  - sem sufixo   → `withTenant`, a trilha do próprio tenant (Admin).
 *  - `AsPlatform` → `withPlatform`, atravessa tenants (Super Admin, SPEC 9.4).
 *
 * Não há função de UPDATE aqui, e nunca deve haver: o banco não concede UPDATE
 * em `audit_logs` a `app_user`. A única remoção possível é o expurgo de
 * retenção, que a própria policy limita a linhas com mais de 12 meses.
 */

interface Row {
  id: string;
  tenant_id: string;
  tenant_name?: string | null;
  user_id: string | null;
  actor_label: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  payload: unknown;
  ip_address: string | null;
  request_id: string | null;
  status: AuditStatus;
  created_at: Date;
}

function toLog(row: Row): AuditLog {
  const log: AuditLog = {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    actorLabel: row.actor_label,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    payload: row.payload ?? null,
    ipAddress: row.ip_address,
    requestId: row.request_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
  if (row.tenant_name) log.tenantName = row.tenant_name;
  return log;
}

// `actor_label` cai para o nome do usuário no mesmo INSERT (subquery escopada
// pela RLS) — evita uma ida extra ao banco por request auditado, e a trilha
// continua legível depois que o usuário for anonimizado ou removido.
const INSERT_SQL = `
  INSERT INTO audit_logs
    (tenant_id, user_id, actor_label, action, entity, entity_id,
     payload, ip_address, request_id, status)
  VALUES ($1, $2,
          COALESCE($3, (SELECT full_name FROM users WHERE id = $2)),
          $4, $5, $6, $7::jsonb, $8::inet, $9, $10)
  RETURNING *`;

function insertValues(tenantId: string, entry: AuditEntry): unknown[] {
  return [
    tenantId,
    entry.userId ?? null,
    entry.actorLabel ?? null,
    entry.action,
    entry.entity,
    entry.entityId ?? null,
    entry.payload === undefined || entry.payload === null
      ? null
      : JSON.stringify(entry.payload),
    // IP inválido (ou ausente) entra como NULL em vez de derrubar o INSERT.
    normalizeIp(entry.ipAddress),
    entry.requestId ?? null,
    entry.status ?? "OK",
  ];
}

/**
 * O Fastify entrega `::ffff:127.0.0.1` para conexão IPv4 num socket IPv6 — o
 * tipo `inet` aceita, mas a leitura fica ilegível. Normaliza para o IPv4.
 */
function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(trimmed);
  return mapped?.[1] ?? trimmed;
}

export async function insertAuditLog(
  tenantId: string,
  entry: AuditEntry,
): Promise<AuditLog> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(INSERT_SQL, insertValues(tenantId, entry));
    return toLog(rows[0]!);
  });
}

/** Monta o WHERE compartilhado pelas duas visões. */
function buildFilters(
  query: AuditQuery | GlobalAuditQuery,
): { where: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  /** `make` recebe a posição do parâmetro que acabou de entrar em `values`. */
  const add = (make: (i: number) => string, value: unknown) => {
    values.push(value);
    clauses.push(make(values.length));
  };

  if ("tenantId" in query && query.tenantId) add((i) => `a.tenant_id = $${i}`, query.tenantId);
  if (query.action) add((i) => `a.action = $${i}`, query.action);
  if (query.entity) add((i) => `a.entity = $${i}`, query.entity);
  if (query.entityId) add((i) => `a.entity_id = $${i}`, query.entityId);
  if (query.userId) add((i) => `a.user_id = $${i}`, query.userId);
  if (query.status) add((i) => `a.status = $${i}`, query.status);
  if (query.from) add((i) => `a.created_at >= $${i}::date`, query.from);
  // O dia de `to` entra inteiro.
  if (query.to) add((i) => `a.created_at < ($${i}::date + interval '1 day')`, query.to);
  if (query.q) {
    add(
      (i) =>
        `(a.action ILIKE '%' || $${i} || '%'` +
        ` OR a.actor_label ILIKE '%' || $${i} || '%'` +
        ` OR a.entity_id = $${i})`,
      query.q,
    );
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

export async function listAuditLogs(
  tenantId: string,
  query: AuditQuery,
): Promise<AuditPage> {
  const { where, values } = buildFilters(query);
  const offset = (query.page - 1) * query.limit;
  return withTenant(tenantId, async (client) => {
    const { rows: countRows } = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM audit_logs a ${where}`,
      values,
    );
    const { rows } = await client.query<Row>(
      `SELECT a.* FROM audit_logs a ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, query.limit, offset],
    );
    return {
      items: rows.map(toLog),
      total: Number(countRows[0]?.total ?? 0),
      page: query.page,
      limit: query.limit,
    };
  });
}

export async function listAuditLogsAsPlatform(
  query: GlobalAuditQuery,
): Promise<AuditPage> {
  const { where, values } = buildFilters(query);
  const offset = (query.page - 1) * query.limit;
  return withPlatform(async (client) => {
    const { rows: countRows } = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM audit_logs a ${where}`,
      values,
    );
    const { rows } = await client.query<Row>(
      `SELECT a.*, t.name AS tenant_name
         FROM audit_logs a
         LEFT JOIN tenants t ON t.id = a.tenant_id
       ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, query.limit, offset],
    );
    return {
      items: rows.map(toLog),
      total: Number(countRows[0]?.total ?? 0),
      page: query.page,
      limit: query.limit,
    };
  });
}

/** Contadores das últimas 24h para os cartões do painel da plataforma. */
export async function summaryAsPlatform(): Promise<AuditSummary> {
  return withPlatform(async (client) => {
    const { rows } = await client.query<{
      last24h: string;
      sensitive24h: string;
      ai24h: string;
      denied24h: string;
    }>(
      `SELECT
         COUNT(*)::text                                          AS "last24h",
         COUNT(*) FILTER (
           WHERE action = ANY($1::text[])
              OR action LIKE '%deleted'
              OR action LIKE '%removed'
         )::text                                                 AS "sensitive24h",
         COUNT(*) FILTER (WHERE action LIKE 'ai.%')::text        AS "ai24h",
         COUNT(*) FILTER (WHERE status = 'DENIED')::text         AS "denied24h"
       FROM audit_logs
       WHERE created_at >= now() - interval '24 hours'`,
      [[...SENSITIVE_ACTIONS]],
    );
    const row = rows[0];
    return {
      last24h: Number(row?.last24h ?? 0),
      sensitive24h: Number(row?.sensitive24h ?? 0),
      ai24h: Number(row?.ai24h ?? 0),
      denied24h: Number(row?.denied24h ?? 0),
    };
  });
}

/**
 * Expurgo de retenção (LGPD): remove o que passou de `months` meses. A policy
 * `audit_purge` só deixa apagar linhas com mais de 12 meses — pedir menos que
 * isso simplesmente não remove nada, e é essa a intenção.
 */
export async function purgeOlderThan(months: number): Promise<number> {
  return withPlatform(async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM audit_logs WHERE created_at < now() - ($1 || ' months')::interval`,
      [String(months)],
    );
    return rowCount ?? 0;
  });
}
