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
const activeCache = new Map<string, { resolved: Resolved; expiresAt: number }>();

export function list(): Promise<Tenant[]> {
  return repo.listTenantsAsPlatform();
}

/** A própria imobiliária (id do contexto da sessão). */
export async function getById(id: string): Promise<Tenant> {
  const tenant = await repo.findTenantById(id);
  if (!tenant) throw AppError.notFound("Tenant não encontrado");
  return tenant;
}

/** Qualquer tenant — só a área de plataforma. */
export async function getByIdAsPlatform(id: string): Promise<Tenant> {
  const tenant = await repo.findTenantByIdAsPlatform(id);
  if (!tenant) throw AppError.notFound("Tenant não encontrado");
  return tenant;
}

export async function create(input: CreateTenantInput): Promise<Tenant> {
  const existing = await repo.findTenantBySlug(input.slug);
  if (existing) {
    throw new AppError("CONFLICT", 409, `Slug '${input.slug}' já está em uso`);
  }

  const tenant = await repo.insertTenantAsPlatform(input);

  await publish({
    type: "tenant.created",
    tenantId: tenant.id,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { slug: tenant.slug, plan: tenant.plan },
  });

  return tenant;
}

/** Edição pela plataforma (Super Admin): qualquer tenant, inclusive status/plano. */
export function updateAsPlatform(id: string, patch: UpdateTenantInput): Promise<Tenant> {
  return applyUpdate(id, patch, () => repo.updateTenantAsPlatform(id, patch));
}

/** Edição pela própria imobiliária (Configurações). */
export function update(id: string, patch: UpdateTenantInput): Promise<Tenant> {
  return applyUpdate(id, patch, () => repo.updateCurrentTenant(id, patch));
}

async function applyUpdate(
  id: string,
  patch: UpdateTenantInput,
  run: () => Promise<Tenant | null>,
): Promise<Tenant> {
  // O slug é o subdomínio: único global. Sem esta checagem o UNIQUE do banco
  // estouraria como erro interno em vez de 409.
  if (patch.slug !== undefined) {
    const owner = await repo.findTenantBySlug(patch.slug);
    if (owner && owner.id !== id) {
      throw new AppError("CONFLICT", 409, `Slug '${patch.slug}' já está em uso`);
    }
  }

  const tenant = await run();
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

/** O que o gate de request precisa saber do tenant, em uma leitura só. */
interface Resolved {
  state: ResolveState;
  /** organização do tenant no Clerk — contraprova do claim `tenant_id`. */
  clerkOrgId: string | null;
}

function stateFor(tenant: { status: string } | null): ResolveState {
  if (tenant === null) return "not_found";
  return tenant.status === "active" || tenant.status === "trial" ? "ok" : "suspended";
}

function raise(state: ResolveState): void {
  if (state === "not_found") throw AppError.tenantNotResolved("Tenant não encontrado");
  if (state === "suspended") throw AppError.tenantSuspended();
}

async function resolve(id: string): Promise<Resolved> {
  const now = Date.now();
  const cached = activeCache.get(id);
  if (cached && cached.expiresAt > now) return cached.resolved;

  const tenant = await repo.findTenantById(id);
  const resolved: Resolved = {
    state: stateFor(tenant),
    clerkOrgId: tenant?.clerkOrgId ?? null,
  };
  activeCache.set(id, { resolved, expiresAt: now + CACHE_TTL_MS });
  return resolved;
}

export async function assertActive(id: string): Promise<void> {
  return raise((await resolve(id)).state);
}

/**
 * Contraprova do claim `tenant_id` (MOD-AUTH-05): confere se a organização do
 * token é a organização registrada para este tenant.
 *
 * Sem isso, todo o isolamento penderia de um único mapeamento no Clerk
 * (`org.public_metadata.tenant_id` → claim): um template mal configurado ou um
 * metadata sobrescrito produziria um token válido apontando para o tenant de
 * outra imobiliária, e o backend não teria como recusar. Aproveita o cache do
 * `assertActive`, então não custa uma query a mais por request.
 *
 * NÃO é tolerante com `clerk_org_id` nulo: quem chega com organização no token
 * veio do Clerk, e um tenant sem org registrada não é dele. A tolerância antiga
 * ("não há o que comparar") era a brecha que deixava um claim `tenant_id`
 * apontando para qualquer tenant criado fora do Clerk — inclusive os de teste —
 * passar sem contestação. Tenant legítimo ganha `clerk_org_id` no onboarding;
 * se um tenant antigo perder o vínculo (ex.: `npm run infra:reset` recria o
 * demo sem a coluna), a correção é regravar a coluna, não afrouxar o gate.
 */
export async function assertOrgMatches(id: string, orgId: string): Promise<void> {
  const { clerkOrgId } = await resolve(id);
  if (clerkOrgId !== orgId) {
    throw new AppError(
      "ERR_AUTH_009",
      401,
      clerkOrgId
        ? "Organização do token não corresponde ao tenant"
        : "Tenant sem organização vinculada no Clerk",
    );
  }
}
