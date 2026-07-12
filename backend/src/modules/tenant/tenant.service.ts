import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import * as repo from "./tenant.repository.js";
import type { CreateTenantInput, Tenant, UpdateTenantInput } from "./tenant.schema.js";

/**
 * Regras de negócio de tenants + resolução de tenant ativo.
 *
 * `assertActive` é chamado em TODO request /v1 (ver gateway) para garantir que
 * o tenant do header/JWT existe e está ativo. Como isso rodaria a cada request,
 * mantemos um cache curto em memória para evitar um SELECT por request. Em
 * produção multi-instância, trocar por cache no Redis (invalidação por evento
 * `tenant.updated`).
 */

const CACHE_TTL_MS = 30_000;
const activeCache = new Map<string, { state: ResolveState; expiresAt: number }>();

export function list(): Promise<Tenant[]> {
  return repo.listTenants();
}

export async function getById(id: string): Promise<Tenant> {
  const tenant = await repo.findTenantById(id);
  if (!tenant) throw AppError.notFound("Tenant não encontrado");
  return tenant;
}

export async function create(input: CreateTenantInput): Promise<Tenant> {
  const existing = await repo.findTenantBySlug(input.slug);
  if (existing) {
    throw new AppError("CONFLICT", 409, `Slug '${input.slug}' já está em uso`);
  }

  const tenant = await repo.insertTenant(input);

  await publish({
    type: "tenant.created",
    tenantId: tenant.id,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { slug: tenant.slug, plan: tenant.plan },
  });

  return tenant;
}

export async function update(id: string, patch: UpdateTenantInput): Promise<Tenant> {
  const tenant = await repo.updateTenant(id, patch);
  if (!tenant) throw AppError.notFound("Tenant não encontrado");

  activeCache.delete(id); // invalida o cache (status/plano podem ter mudado)

  await publish({
    type: "tenant.updated",
    tenantId: tenant.id,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { status: tenant.status, plan: tenant.plan },
  });

  return tenant;
}

/**
 * Garante que o tenant existe e pode operar. Usado na resolução de tenant de
 * todo request /v1 (PRD MOD-AUTH-02). Semântica dos erros:
 *  - tenant inexistente → 401 ERR_AUTH_005 (não foi possível resolver);
 *  - tenant existe mas suspenso/inativo/cancelado → 403 ERR_AUTH_006.
 * Estados que podem usar o produto: `active` e `trial`.
 */
type ResolveState = "ok" | "not_found" | "suspended";

function stateFor(tenant: { status: string } | null): ResolveState {
  if (tenant === null) return "not_found";
  return tenant.status === "active" || tenant.status === "trial" ? "ok" : "suspended";
}

function raise(state: ResolveState): void {
  if (state === "not_found") throw AppError.tenantNotResolved("Tenant não encontrado");
  if (state === "suspended") throw AppError.tenantSuspended();
}

export async function assertActive(id: string): Promise<void> {
  const now = Date.now();
  const cached = activeCache.get(id);
  if (cached && cached.expiresAt > now) {
    return raise(cached.state);
  }

  const tenant = await repo.findTenantById(id);
  const state = stateFor(tenant);
  activeCache.set(id, { state, expiresAt: now + CACHE_TTL_MS });
  return raise(state);
}
