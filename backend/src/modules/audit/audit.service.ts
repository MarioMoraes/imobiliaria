import { getContext } from "../../shared/tenant-context.js";
import { logger } from "../../shared/logger.js";
import * as repo from "./audit.repository.js";
import { redact } from "./audit.redact.js";
import type {
  AuditEntry,
  AuditPage,
  AuditQuery,
  AuditSummary,
  GlobalAuditQuery,
} from "./audit.schema.js";

/**
 * Trilha de auditoria (MOD-AUTH-07 / SPEC 9.4). Este service é a interface
 * pública do módulo: quem quiser registrar algo importa `record` daqui — nunca
 * o repositório.
 *
 * A maior parte da trilha nasce sozinha no gateway (ver
 * `gateway/audit.hook.ts`), que cobre toda mutação de /v1. `record` é para o
 * que não cabe num verbo HTTP: download de documento (é GET), webhook de
 * provedor (fora de /v1) e o aceite de convite.
 */

/**
 * Grava uma linha da trilha. **Best-effort, nunca lança**: a auditoria não pode
 * derrubar uma escrita de domínio que já foi confirmada (mesma política do
 * `publish` de eventos). Falha vira aviso no log.
 *
 * O que não vier no `entry` é preenchido pelo contexto do request
 * (tenant, usuário, IP, requestId). O `payload` passa pela redação sempre —
 * ninguém precisa lembrar de mascarar um segredo na hora de chamar.
 */
export async function record(entry: AuditEntry): Promise<void> {
  try {
    const ctx = getContext();
    const tenantId = entry.tenantId ?? ctx?.tenantId;
    if (!tenantId) {
      logger.warn({ action: entry.action }, "auditoria sem tenant (ignorada)");
      return;
    }
    const prepared: AuditEntry = {
      ...entry,
      userId: entry.userId ?? ctx?.userId ?? null,
      ipAddress: entry.ipAddress ?? ctx?.ip ?? null,
      requestId: entry.requestId ?? ctx?.requestId ?? null,
      payload: redact(entry.payload),
    };
    // Sempre `withTenant`, mesmo no webhook (onde o tenant vem da URL já
    // validada): a escrita da trilha não precisa de escopo de plataforma, e
    // manter `withPlatform` restrito à leitura global do Super Admin mantém
    // pequena a superfície que enxerga além de um tenant.
    await repo.insertAuditLog(tenantId, prepared);
  } catch (err) {
    logger.warn({ err, action: entry.action }, "falha ao gravar auditoria (ignorada)");
  }
}

/** Trilha do próprio tenant (Admin). */
export function list(tenantId: string, query: AuditQuery): Promise<AuditPage> {
  return repo.listAuditLogs(tenantId, query);
}

/** Visão global cross-tenant (Super Admin — MOD-SADMIN-04). */
export function listGlobal(query: GlobalAuditQuery): Promise<AuditPage> {
  return repo.listAuditLogsAsPlatform(query);
}

export function summary(): Promise<AuditSummary> {
  return repo.summaryAsPlatform();
}

/**
 * Expurgo de retenção (LGPD — PRD 01 seção 9: o IP é retido por 12 meses).
 * Não há agendador no projeto: isto roda quando alguém dispara
 * `POST /admin/audit/purge`. A policy do banco recusa qualquer janela menor.
 */
export function purge(months = 12): Promise<number> {
  return repo.purgeOlderThan(months);
}
