import { redis } from "../../shared/redis.js";
import { logger } from "../../shared/logger.js";
import * as repo from "./rbac.repository.js";

/**
 * Carrega papéis do usuário para o RBAC. No fluxo Clerk resolve o usuário local
 * pelo id externo e cacheia o resultado no Redis (`rbac:{tenantId}:{clerkId}`,
 * TTL 300s — PRD seção 10), invalidado por `role.changed`. O cache é best-effort:
 * se o Redis estiver fora, cai direto no banco.
 */
const TTL_SECONDS = 300;

function key(tenantId: string, clerkExternalId: string): string {
  return `rbac:${tenantId}:${clerkExternalId}`;
}

export async function loadForClerkUser(
  tenantId: string,
  clerkExternalId: string,
): Promise<{ userId: string | null; roles: string[] }> {
  const cached = await readCache(tenantId, clerkExternalId);
  if (cached) return cached;

  const resolved = await repo.resolveUserAndRoles(tenantId, clerkExternalId);
  await writeCache(tenantId, clerkExternalId, resolved);
  return resolved;
}

/**
 * Reivindica o convite de um membro no 1º login (vincula clerk_external_id +
 * ativa). Chamado pelo auth-context.hook quando não há usuário local para o
 * `sub` do Clerk. Em sucesso, invalida o cache (que guardava `{userId:null}`)
 * e devolve os papéis já efetivos. `null` = nenhum convite pendente a casar.
 */
export async function claimInvitedMembership(
  tenantId: string,
  clerkExternalId: string,
  email: string,
): Promise<{ userId: string; roles: string[] } | null> {
  const claimed = await repo.claimInvitedUser(tenantId, clerkExternalId, email);
  if (claimed) await invalidate(tenantId, clerkExternalId);
  return claimed;
}

/** Invalida o cache de papéis de um usuário (chamar após `role.changed`). */
export async function invalidate(tenantId: string, clerkExternalId: string): Promise<void> {
  if (redis.status !== "ready") return;
  try {
    await redis.del(key(tenantId, clerkExternalId));
  } catch (err) {
    logger.warn({ err }, "falha ao invalidar cache de rbac");
  }
}

async function readCache(
  tenantId: string,
  clerkExternalId: string,
): Promise<{ userId: string | null; roles: string[] } | null> {
  if (redis.status !== "ready") return null;
  try {
    const raw = await redis.get(key(tenantId, clerkExternalId));
    return raw ? (JSON.parse(raw) as { userId: string | null; roles: string[] }) : null;
  } catch (err) {
    logger.warn({ err }, "falha ao ler cache de rbac");
    return null;
  }
}

async function writeCache(
  tenantId: string,
  clerkExternalId: string,
  value: { userId: string | null; roles: string[] },
): Promise<void> {
  if (redis.status !== "ready") return;
  try {
    await redis.set(key(tenantId, clerkExternalId), JSON.stringify(value), "EX", TTL_SECONDS);
  } catch (err) {
    logger.warn({ err }, "falha ao escrever cache de rbac");
  }
}
