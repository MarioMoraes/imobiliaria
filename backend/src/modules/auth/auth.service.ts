import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { logger } from "../../shared/logger.js";
import {
  clerkClient,
  isClerkConfigured,
  verifyClerkSession,
} from "../../shared/clerk.js";
import { authDevMode } from "../../config/env.js";
import type { Tenant } from "../tenant/tenant.schema.js";
import {
  deleteTenantAsPlatform,
  findTenantByClerkOrgId,
  findTenantByCnpj,
  findTenantBySlug,
} from "../tenant/tenant.repository.js";
import * as repo from "./auth.repository.js";
import type { AdminIdentity } from "./auth.repository.js";
import type { OnboardedUser, OnboardingInput } from "./auth.schema.js";

export interface OnboardingResult {
  tenant: Tenant;
  user: OnboardedUser;
  clerkOrgId: string | null;
}

/**
 * MOD-AUTH-04/05 — Onboarding self-service. Dois caminhos:
 *  - Clerk (bearer + Clerk configurado): usuário já autenticado (sign-up feito);
 *    criamos a Organização (= tenant), vinculamos `clerk_external_id`/`clerk_org_id`
 *    e gravamos `tenant_id` em `org.public_metadata` (fonte do claim do JWT).
 *  - dev-mode (sem token): cria tenant + admin do payload, sem Clerk.
 * Em ambos publica `tenant.created` + `user.activated` (PRD seção 8).
 */
export async function onboarding(
  input: OnboardingInput,
  bearer?: string,
): Promise<OnboardingResult> {
  // Unicidade global → 409 (a constraint no banco é a garantia final).
  if (await findTenantByCnpj(input.studio.cnpj)) {
    throw AppError.conflict("CNPJ já cadastrado");
  }
  if (await findTenantBySlug(input.studio.slug)) {
    throw AppError.conflict(`Slug '${input.studio.slug}' já está em uso`);
  }

  if (bearer && isClerkConfigured()) {
    return clerkOnboarding(input, bearer);
  }
  // Criar tenant + ADMIN é a operação mais poderosa da API. Sem sessão
  // verificada ela só existe na máquina do desenvolvedor: antes, bastava omitir
  // o header `Authorization` para provisionar tenants anonimamente, em produção
  // e com o e-mail do admin escolhido pelo chamador.
  if (!authDevMode()) {
    throw AppError.tenantNotResolved("Onboarding exige uma sessão autenticada");
  }
  return devOnboarding(input);
}

async function clerkOnboarding(
  input: OnboardingInput,
  bearer: string,
): Promise<OnboardingResult> {
  const { userId } = await verifyClerkSession(bearer);
  const clerkUser = await clerkClient.users.getUser(userId);
  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) throw AppError.badRequest("Usuário Clerk sem e-mail");
  const admin: AdminIdentity = {
    email,
    fullName: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || email,
  };

  // 1) resolve a org no Clerk: adota a que o Clerk já criou para este usuário
  // (ver `resolveOrganization`) ou cria uma nova.
  const org = await resolveOrganization(userId, input.studio.name);

  // 2) cria tenant + admin (DB). Se falhar, desfaz a org — mas SÓ se ela nasceu
  // aqui: apagar uma org adotada destruiria algo que já era do usuário.
  let result: { tenant: Tenant; user: OnboardedUser };
  try {
    result = await repo.createTenantWithAdmin(input, admin, {
      clerkUserId: userId,
      clerkOrgId: org.id,
    });
  } catch (err) {
    if (org.created) {
      await clerkClient.organizations
        .deleteOrganization(org.id)
        .catch((e) => logger.warn({ e, orgId: org.id }, "falha ao limpar org órfã"));
    }
    throw err;
  }

  // 3) grava tenant_id no metadata da org (fonte do claim tenant_id do JWT).
  // NÃO é reparável em silêncio: sem esse metadata nenhum token da org carrega
  // `tenant_id`, então o usuário fica trancado fora do produto que acabou de
  // criar — e é justamente esse claim que sustenta o isolamento. Uma retentativa
  // (falha transitória da API), e persistindo o erro desfazemos tudo.
  try {
    await writeTenantMetadata(org.id, result.tenant.id);
  } catch (err) {
    await rollbackOnboarding(org.id, result.tenant.id, org.created);
    logger.error(
      { err, orgId: org.id, tenantId: result.tenant.id },
      "onboarding desfeito: não foi possível gravar tenant_id no metadata da org",
    );
    throw new AppError(
      "INTERNAL",
      500,
      "Não foi possível concluir o cadastro (falha ao vincular a organização). Tente novamente.",
    );
  }

  await publishOnboardingEvents(result.tenant, result.user);
  return { ...result, clerkOrgId: org.id };
}

/** Organização do Clerk que vai receber o tenant, e se nasceu neste request. */
interface ResolvedOrg {
  id: string;
  /** `false` quando adotamos uma org que já existia — importa no rollback. */
  created: boolean;
}

/**
 * Decide em QUAL organização do Clerk o tenant será criado.
 *
 * Não basta criar uma: com "force organization selection" ligado na instância,
 * o próprio Clerk exibe a tela nativa de criar organização logo após o sign-up e
 * já entrega o usuário com uma org — sem `tenant_id` no metadata e sem nada no
 * nosso banco. Criar outra aqui deixaria o usuário com duas orgs, a ativa na
 * sessão sendo justamente a que não aponta para tenant nenhum: token sem claim,
 * 401 em todo /v1, e o painel inteiro parecendo "backend fora do ar".
 *
 * Então: se o usuário já é admin de uma org órfã (sem tenant no nosso banco),
 * adotamos essa org — inclusive renomeando-a para o nome informado no formulário.
 * Se alguma das orgs dele já tem tenant, o onboarding não se aplica (409).
 */
async function resolveOrganization(userId: string, name: string): Promise<ResolvedOrg> {
  const memberships = await clerkClient.users.getOrganizationMembershipList({
    userId,
    limit: 100,
  });

  // A autoridade sobre "já onboardado" é o NOSSO banco, não o metadata da org
  // (que pode estar vazio ou defasado — é só o espelho que alimenta o claim).
  for (const membership of memberships.data) {
    if (await findTenantByClerkOrgId(membership.organization.id)) {
      throw AppError.conflict("Este usuário já pertence a uma imobiliária");
    }
  }

  const orphan = memberships.data.find((m) => m.role === "org:admin");
  if (orphan) {
    const orgId = orphan.organization.id;
    // O nome que vale é o do nosso formulário: o da tela do Clerk foi digitado
    // sem contexto (e o fallback dele é literalmente "My Organization").
    await clerkClient.organizations
      .updateOrganization(orgId, { name })
      .catch((err) => logger.warn({ err, orgId }, "falha ao renomear org adotada"));
    logger.info({ orgId, userId }, "onboarding adotou organização existente do Clerk");
    return { id: orgId, created: false };
  }

  const org = await clerkClient.organizations.createOrganization({ name, createdBy: userId });
  return { id: org.id, created: true };
}

/**
 * Grava `tenant_id` no metadata da organização — a fonte do claim do JWT. Uma
 * retentativa curta cobre falha transitória da API do Clerk; o caller trata o
 * fracasso definitivo desfazendo o onboarding.
 */
async function writeTenantMetadata(orgId: string, tenantId: string): Promise<void> {
  try {
    await clerkClient.organizations.updateOrganization(orgId, {
      publicMetadata: { tenant_id: tenantId },
    });
  } catch (err) {
    logger.warn({ err, orgId }, "1ª tentativa de gravar tenant_id no metadata falhou");
    await clerkClient.organizations.updateOrganization(orgId, {
      publicMetadata: { tenant_id: tenantId },
    });
  }
}

/**
 * Desfaz um onboarding pela metade: apaga o tenant no banco (users/user_roles
 * saem por cascata) e, se a org nasceu neste request, apaga a org também. Melhor
 * não deixar nada do que deixar um tenant inacessível — o usuário pode
 * simplesmente tentar de novo, com o mesmo CNPJ e slug.
 *
 * Org ADOTADA não é apagada: ela já era do usuário antes de nós, e removê-la
 * tiraria dele a organização ativa da sessão por um erro nosso. Ela volta ao
 * estado em que estava (órfã), e a próxima tentativa a adota de novo.
 */
async function rollbackOnboarding(
  orgId: string,
  tenantId: string,
  orgCreatedHere: boolean,
): Promise<void> {
  if (orgCreatedHere) {
    await clerkClient.organizations
      .deleteOrganization(orgId)
      .catch((e) => logger.warn({ e, orgId }, "falha ao limpar org no rollback"));
  }
  await deleteTenantAsPlatform(tenantId).catch((e) =>
    logger.error({ e, tenantId }, "falha ao limpar tenant no rollback — órfão no banco"),
  );
}

async function devOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
  if (!input.admin) {
    throw AppError.badRequest("admin é obrigatório no dev-mode (sem sessão Clerk)");
  }
  const result = await repo.createTenantWithAdmin(input, input.admin);
  await publishOnboardingEvents(result.tenant, result.user);
  return { ...result, clerkOrgId: null };
}

async function publishOnboardingEvents(tenant: Tenant, user: OnboardedUser): Promise<void> {
  const now = new Date().toISOString();
  await publish({
    type: "tenant.created",
    tenantId: tenant.id,
    eventId: randomUUID(),
    occurredAt: now,
    payload: { slug: tenant.slug, plan: tenant.plan, status: tenant.status },
  });
  await publish({
    type: "user.activated",
    tenantId: tenant.id,
    eventId: randomUUID(),
    occurredAt: now,
    payload: { userId: user.id, email: user.email, role: "ADMIN" },
  });
}
