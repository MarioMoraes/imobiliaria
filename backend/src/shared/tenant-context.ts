import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyRequest } from "fastify";
import { AppError } from "./errors.js";
import { env } from "../config/env.js";
import { verifyClerkToken } from "./clerk.js";

/**
 * Contexto de autenticação propagado por request via AsyncLocalStorage
 * (SPEC seção 3.1). Nenhuma query de domínio pode rodar sem um tenant
 * resolvido — o acesso a dados sempre passa por `withTenant(...)`.
 *
 * Fase 0+ (MOD-AUTH-05): a identidade vem do JWT de sessão do Clerk (claims
 * `tenant_id` + `sub`). Em desenvolvimento, `AUTH_DEV_MODE` permite simular a
 * sessão pelos headers `x-tenant-id` + `x-dev-roles` (nunca em produção).
 * Migrar de provedor = trocar `verifyClerkToken`/`resolveAuth`; o contrato de
 * `getTenantId()`/`getAuthUser()` permanece imutável (RN-06).
 */
export interface TenantContext {
  tenantId: string;
  /** id do usuário autenticado (nosso `users.id`); ausente no dev-mode sem usuário real. */
  userId?: string;
  /** papéis efetivos do usuário (RBAC). */
  roles: string[];
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

export function getAuthUser(): { userId?: string; roles: string[] } {
  const ctx = storage.getStore();
  if (!ctx) throw AppError.tenantRequired();
  return { userId: ctx.userId, roles: ctx.roles };
}

/** Resultado da resolução de identidade (antes de carregar papéis do banco). */
export interface ResolvedAuth {
  tenantId: string;
  userId?: string;
  /** papéis vindos do header no dev-mode; no fluxo Clerk fica vazio (carregados do banco). */
  devRoles: string[];
  /** true quando a identidade veio de um token Clerk válido. */
  viaClerk: boolean;
}

/**
 * Resolve a identidade do request. NÃO toca no banco — apenas extrai
 * tenant/usuário do token (Clerk) ou dos headers de desenvolvimento.
 */
export async function resolveAuth(req: FastifyRequest): Promise<ResolvedAuth> {
  const auth = req.headers["authorization"];
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ")
    ? auth.slice(7).trim()
    : undefined;

  if (bearer) {
    const { tenantId, userId } = await verifyClerkToken(bearer);
    return { tenantId, userId, devRoles: [], viaClerk: true };
  }

  if (env.AUTH_DEV_MODE) {
    const header = req.headers["x-tenant-id"];
    const tenantId = Array.isArray(header) ? header[0] : header;
    if (!tenantId) throw AppError.tenantNotResolved("Header x-tenant-id ausente");
    return { tenantId, userId: undefined, devRoles: parseRoles(req), viaClerk: false };
  }

  throw AppError.tenantNotResolved("Sem token de sessão");
}

function parseRoles(req: FastifyRequest): string[] {
  const header = req.headers["x-dev-roles"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return [];
  return raw
    .split(",")
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Executa o restante do ciclo do request dentro do AsyncLocalStorage. Usado pelo
 * hook de composição no gateway (estilo callback do Fastify — mantém o contexto
 * ativo por toda a vida do request).
 */
export function runInContext(ctx: TenantContext, done: () => void): void {
  storage.run(ctx, done);
}
