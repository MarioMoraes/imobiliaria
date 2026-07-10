import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { AppError } from "./errors.js";

/**
 * Contexto de tenant propagado por request via AsyncLocalStorage
 * (SPEC seção 3.1). Nenhuma query de domínio pode rodar sem um tenant
 * resolvido — o acesso a dados sempre passa por `withTenant(...)`.
 *
 * NOTA (Fase 0): aqui o tenant é resolvido pelo header `x-tenant-id`.
 * Na Fase 0 real (auth) isso passa a vir do claim `tenant_id` do JWT
 * emitido pelo Clerk, ou do subdomínio (landing/portais). Trocar apenas
 * a função `resolveTenantId` abaixo.
 */
export interface TenantContext {
  tenantId: string;
  requestId: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function getContext(): TenantContext | undefined {
  return storage.getStore();
}

export function getTenantId(): string {
  const ctx = storage.getStore();
  if (!ctx) throw AppError.tenantRequired();
  return ctx.tenantId;
}

export function resolveTenantId(req: FastifyRequest): string {
  const header = req.headers["x-tenant-id"];
  const tenantId = Array.isArray(header) ? header[0] : header;
  if (!tenantId) throw AppError.tenantRequired("Header x-tenant-id ausente");
  return tenantId;
}

/**
 * Hook Fastify (onRequest) que resolve o tenant e abre o AsyncLocalStorage
 * para todo o ciclo de vida do request. Registre-o apenas nas rotas que
 * exigem tenant (ex.: /v1/*), nunca em /health.
 */
export function tenantContextHook(
  req: FastifyRequest,
  _reply: unknown,
  done: () => void,
): void {
  const tenantId = resolveTenantId(req);
  const requestId = (req.id as string) ?? randomUUID();
  storage.run({ tenantId, requestId }, done);
}
