import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { logger } from "../../shared/logger.js";
import {
  clerkClient,
  isClerkConfigured,
  verifyClerkSession,
} from "../../shared/clerk.js";
import type { Tenant } from "../tenant/tenant.schema.js";
import { findTenantByCnpj, findTenantBySlug } from "../tenant/tenant.repository.js";
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

  // 1) cria a org no Clerk (o criador vira admin da org).
  const org = await clerkClient.organizations.createOrganization({
    name: input.studio.name,
    createdBy: userId,
  });

  // 2) cria tenant + admin (DB). Se falhar, desfaz a org para não deixar órfã.
  let result: { tenant: Tenant; user: OnboardedUser };
  try {
    result = await repo.createTenantWithAdmin(input, admin, {
      clerkUserId: userId,
      clerkOrgId: org.id,
    });
  } catch (err) {
    await clerkClient.organizations
      .deleteOrganization(org.id)
      .catch((e) => logger.warn({ e, orgId: org.id }, "falha ao limpar org órfã"));
    throw err;
  }

  // 3) grava tenant_id no metadata da org (fonte do claim tenant_id do JWT).
  try {
    await clerkClient.organizations.updateOrganization(org.id, {
      publicMetadata: { tenant_id: result.tenant.id },
    });
  } catch (err) {
    logger.warn(
      { err, orgId: org.id, tenantId: result.tenant.id },
      "falha ao gravar tenant_id no metadata da org (reparável)",
    );
  }

  await publishOnboardingEvents(result.tenant, result.user);
  return { ...result, clerkOrgId: org.id };
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
