import { z } from "zod";

/**
 * Trilha de auditoria (MOD-AUTH-07 / SPEC 9.4). Um registro por ação sensível:
 * quem fez (`userId` + `actorLabel`), o quê (`action`/`entity`/`entityId`), de
 * onde (`ipAddress`) e quando. Imutável — não existe rota de edição, e o banco
 * não concede UPDATE a `app_user` (ver infra/postgres/init.sql).
 */

/** `OK` = ação concluída; `DENIED` = tentativa barrada pelo RBAC (403). */
export const auditStatus = z.enum(["OK", "DENIED"]);
export type AuditStatus = z.infer<typeof auditStatus>;

/** Entrada a gravar. Tenant/usuário/IP vêm do contexto quando omitidos. */
export interface AuditEntry {
  /** `entidade.acao` — ex.: `property.created`, `contract.signed`. */
  action: string;
  entity: string;
  entityId?: string | null;
  payload?: unknown;
  status?: AuditStatus;
  /** Preenchidos pelo `record()` a partir do contexto do request se ausentes. */
  tenantId?: string;
  userId?: string | null;
  actorLabel?: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
}

/** Registro como sai para a API. */
export interface AuditLog {
  id: string;
  tenantId: string;
  /** Nome da imobiliária — só na visão global do Super Admin. */
  tenantName?: string;
  userId: string | null;
  actorLabel: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  payload: unknown;
  ipAddress: string | null;
  requestId: string | null;
  status: AuditStatus;
  createdAt: string;
}

export interface AuditPage {
  items: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Filtros da consulta. `from`/`to` são datas de calendário (o dia inteiro de
 * `to` entra: a comparação é `< to + 1 dia`, feita no repositório).
 */
export const auditQuery = z.object({
  action: z.string().max(80).optional(),
  entity: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  userId: z.string().uuid().optional(),
  status: auditStatus.optional(),
  /** Busca livre em ação/ator/alvo. */
  q: z.string().max(80).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AuditQuery = z.infer<typeof auditQuery>;

/** Filtro da visão global: os mesmos, mais o recorte por tenant. */
export const globalAuditQuery = auditQuery.extend({
  tenantId: z.string().uuid().optional(),
});
export type GlobalAuditQuery = z.infer<typeof globalAuditQuery>;

/** Cartões do painel do Super Admin. */
export interface AuditSummary {
  /** Eventos nas últimas 24h (todos os tenants). */
  last24h: number;
  /** Ações sensíveis (ver SENSITIVE em audit.actions.ts) nas últimas 24h. */
  sensitive24h: number;
  /** Ações do copiloto/agentes de IA nas últimas 24h. */
  ai24h: number;
  /** Tentativas barradas por falta de papel nas últimas 24h. */
  denied24h: number;
}
