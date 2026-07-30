import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyRequest } from "fastify";
import { AppError } from "./errors.js";
import { authDevMode } from "../config/env.js";
import { verifyClerkToken } from "./clerk.js";
import { isUuid } from "./uuid.js";

/**
 * Contexto de autenticação propagado por request via AsyncLocalStorage
 * (SPEC seção 3.1). Nenhuma query de domínio pode rodar sem um tenant
 * resolvido — o acesso a dados sempre passa por `withTenant(...)`.
 *
 * Fase 0+ (MOD-AUTH-05): a identidade vem do JWT de sessão do Clerk (claims
 * `tenant_id` + `sub`). Em desenvolvimento, `authDevMode()` (AUTH_DEV_MODE ligado
 * **e** NODE_ENV=development) permite simular a sessão pelos headers
 * `x-tenant-id` + `x-dev-roles` — os papéis vêm do cliente, então isso é um
 * bypass completo do RBAC e só pode existir na máquina do desenvolvedor.
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
  /**
   * IP de origem do request (`req.ip`). Existe para a trilha de auditoria
   * (MOD-AUTH-07 exige `ip_address`): assim um `record()` chamado no fundo de
   * um service não precisa receber a request como parâmetro.
   */
  ip?: string;
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
  /** organização do token no Clerk — contraprova do tenant_id (ver auth-context.hook). */
  orgId?: string;
  /** papéis vindos do header no dev-mode; no fluxo Clerk fica vazio (carregados do banco). */
  devRoles: string[];
  /** true quando a identidade veio de um token Clerk válido. */
  viaClerk: boolean;
}

/**
 * Resolve a identidade do request. NÃO toca no banco — apenas extrai
 * tenant/usuário do token (Clerk) ou dos headers de desenvolvimento.
 *
 * Ordem das decisões (importa para a segurança):
 *  1. Veio `Authorization`? Então a resposta SAI do token — falha de verificação
 *     é 401, nunca degrada para o header. Antes, qualquer erro era engolido em
 *     dev-mode, e um token inválido somado a `x-tenant-id` dava acesso a
 *     qualquer tenant.
 *  2. A única exceção é o token verificado que ainda não tem organização
 *     (`ERR_AUTH_008`): aí a identidade É legítima e, em dev, o header pode
 *     suprir o tenant para navegar antes do onboarding.
 *  3. Sem `Authorization` nenhum, só o dev-mode aceita headers.
 */
export async function resolveAuth(req: FastifyRequest): Promise<ResolvedAuth> {
  const auth = req.headers["authorization"];
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ")
    ? auth.slice(7).trim()
    : undefined;

  if (bearer) {
    try {
      const { tenantId, userId, orgId } = await verifyClerkToken(bearer);
      return { tenantId, userId, orgId, devRoles: [], viaClerk: true };
    } catch (err) {
      const claimMissing = err instanceof AppError && err.code === "ERR_AUTH_008";
      if (!claimMissing || !authDevMode()) throw err;
      // Cai no fallback abaixo: usuário autenticado, ainda sem organização.
    }
  }

  if (authDevMode()) {
    const header = req.headers["x-tenant-id"];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) throw AppError.tenantNotResolved("Header x-tenant-id ausente");
    if (!isUuid(raw)) throw AppError.tenantNotResolved("Header x-tenant-id não é um UUID");
    return { tenantId: raw, userId: undefined, devRoles: parseRoles(req), viaClerk: false };
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
