import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
  resolveAuth,
  runInContext,
  type TenantContext,
} from "../shared/tenant-context.js";
import { assertActive, assertOrgMatches } from "../modules/tenant/tenant.service.js";
import { claimInvitedMembership, loadForClerkUser } from "../modules/rbac/rbac.service.js";
import { getClerkUserEmail, isClerkConfigured } from "../shared/clerk.js";
import { logger } from "../shared/logger.js";

/**
 * Hook de composição (onRequest) de TODO request /v1: resolve a identidade
 * (Clerk ou dev-mode), garante que o tenant está ativo, carrega os papéis do
 * usuário e abre o AsyncLocalStorage para o restante do ciclo.
 *
 * Estilo callback (não async) de propósito: `runInContext(ctx, done)` mantém o
 * contexto ativo por toda a vida do request (o `storage.run` do AsyncLocalStorage
 * precisa envolver o `done`).
 */
export function authContextHook(
  req: FastifyRequest,
  _reply: unknown,
  done: (err?: Error) => void,
): void {
  buildContext(req)
    .then((ctx) => runInContext(ctx, done))
    .catch((err: Error) => done(err));
}

async function buildContext(req: FastifyRequest): Promise<TenantContext> {
  const auth = await resolveAuth(req);
  await assertActive(auth.tenantId);
  // Contraprova do claim `tenant_id` contra a organização do token: o isolamento
  // não pode depender só de um mapeamento de metadata no Clerk.
  if (auth.orgId) await assertOrgMatches(auth.tenantId, auth.orgId);

  let userId = auth.userId;
  let roles = auth.devRoles;
  if (auth.viaClerk) {
    const resolved = await loadForClerkUser(auth.tenantId, auth.userId!);
    userId = resolved.userId ?? undefined;
    roles = resolved.roles;

    // Sem usuário local para este `sub`: pode ser um membro que acabou de
    // aceitar o convite (users row 'invited', ainda sem clerk_external_id).
    // Casa por e-mail e reivindica a row no 1º acesso. Se não houver convite
    // pendente, segue sem papéis (403) — comportamento inalterado.
    if (!userId && isClerkConfigured()) {
      const claimed = await claimInvite(auth.tenantId, auth.userId!);
      if (claimed) {
        userId = claimed.userId;
        roles = claimed.roles;
      }
    }
  }

  const requestId = (req.id as string) ?? randomUUID();
  return { tenantId: auth.tenantId, userId, roles, requestId };
}

/**
 * Busca o e-mail do usuário no Clerk e tenta reivindicar um convite pendente do
 * tenant. Tolerante a falha: qualquer erro (Clerk indisponível, sem e-mail) só
 * loga e devolve null — o request segue como "sem papel ativo".
 */
async function claimInvite(
  tenantId: string,
  clerkUserId: string,
): Promise<{ userId: string; roles: string[] } | null> {
  try {
    const email = await getClerkUserEmail(clerkUserId);
    if (!email) return null;
    return await claimInvitedMembership(tenantId, clerkUserId, email);
  } catch (err) {
    logger.warn({ err, clerkUserId }, "falha ao reivindicar convite no 1º login");
    return null;
  }
}
