import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
  resolveAuth,
  runInContext,
  type TenantContext,
} from "../shared/tenant-context.js";
import { assertActive } from "../modules/tenant/tenant.service.js";
import { loadForClerkUser } from "../modules/rbac/rbac.service.js";

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

  let userId = auth.userId;
  let roles = auth.devRoles;
  if (auth.viaClerk) {
    const resolved = await loadForClerkUser(auth.tenantId, auth.userId!);
    userId = resolved.userId ?? undefined;
    roles = resolved.roles;
  }

  const requestId = (req.id as string) ?? randomUUID();
  return { tenantId: auth.tenantId, userId, roles, requestId };
}
