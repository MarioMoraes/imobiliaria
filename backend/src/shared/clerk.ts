import { createClerkClient, verifyToken } from "@clerk/backend";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";

/**
 * Cliente da API do Clerk (server-side). Usado pelo onboarding para criar a
 * Organização (= tenant) e gravar `tenant_id` no metadata. `secretKey` pode ser
 * undefined em dev sem Clerk — nesse caso as chamadas falham e o onboarding usa
 * o caminho dev-mode. `isClerkConfigured` deixa essa checagem explícita.
 */
export const clerkClient = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });

export function isClerkConfigured(): boolean {
  return Boolean(env.CLERK_SECRET_KEY || env.CLERK_JWT_KEY);
}

/**
 * Papel RBAC → papel de organização do Clerk. O Clerk só conhece os papéis da
 * org (`org:admin`/`org:member`); os papéis reais do app vivem em `user_roles`
 * no nosso banco. Aqui só distinguimos quem entra como admin da org.
 */
function orgRoleFor(rbacRole: string): "org:admin" | "org:member" {
  return rbacRole === "ADMIN" ? "org:admin" : "org:member";
}

/**
 * Convida um e-mail para a organização (= tenant) no Clerk (MOD-AUTH-06). O
 * `publicMetadata` carrega o vínculo (tenant_id/user_id) para auditoria e para
 * um futuro webhook; o vínculo efetivo hoje acontece no 1º login (por e-mail).
 * Lança em falha (ex.: convite pendente duplicado) — o caller decide o rollback.
 */
export async function inviteToOrganization(params: {
  orgId: string;
  email: string;
  role: string;
  publicMetadata?: Record<string, unknown>;
}): Promise<void> {
  await clerkClient.organizations.createOrganizationInvitation({
    organizationId: params.orgId,
    emailAddress: params.email,
    role: orgRoleFor(params.role),
    publicMetadata: params.publicMetadata,
  });
}

/**
 * E-mail primário de um usuário do Clerk. Usado só no claim-on-first-login para
 * casar a sessão do convidado com a `users` row `invited` (por e-mail). Mantém o
 * Clerk como único ponto que conhece o provedor.
 */
export async function getClerkUserEmail(userId: string): Promise<string | null> {
  const user = await clerkClient.users.getUser(userId);
  return (
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    null
  );
}

/**
 * Verificação do JWT de sessão do Clerk (MOD-AUTH-05). Isolado aqui para ser o
 * ÚNICO ponto que conhece o Clerk — o resto do backend depende só do resultado
 * (`{ tenantId, userId }`). Trocar de provedor = trocar este arquivo.
 *
 * O `tenant_id` vem de um claim customizado do JWT template do Clerk (mapeado de
 * `org.public_metadata.tenant_id` — ver checklist de setup no PRD). `sub` é o id
 * do usuário no Clerk, casado com `users.clerk_external_id`.
 */
export interface ClerkAuth {
  tenantId: string;
  userId: string;
}

/**
 * Verifica um token de sessão do Clerk exigindo apenas a identidade do usuário
 * (claim `sub`), SEM `tenant_id`. Usado no onboarding, quando o usuário já está
 * autenticado mas ainda não pertence a nenhuma organização/tenant.
 */
export async function verifyClerkSession(token: string): Promise<{ userId: string }> {
  if (!isClerkConfigured()) {
    throw AppError.tenantNotResolved("Clerk não configurado (defina CLERK_SECRET_KEY)");
  }
  try {
    const claims = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
      jwtKey: env.CLERK_JWT_KEY,
    });
    return { userId: claims.sub };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ err }, "falha ao verificar sessão do Clerk");
    throw AppError.tenantNotResolved("Token de sessão inválido");
  }
}

export async function verifyClerkToken(token: string): Promise<ClerkAuth> {
  if (!env.CLERK_SECRET_KEY && !env.CLERK_JWT_KEY) {
    // Sem chaves configuradas não há como validar um Bearer real.
    throw AppError.tenantNotResolved("Clerk não configurado (defina CLERK_SECRET_KEY)");
  }
  try {
    const claims = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
      jwtKey: env.CLERK_JWT_KEY,
    });
    const tenantId = typeof claims.tenant_id === "string" ? claims.tenant_id : undefined;
    if (!tenantId) {
      throw AppError.tenantNotResolved("Token sem claim tenant_id");
    }
    return { tenantId, userId: claims.sub };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ err }, "falha ao verificar token do Clerk");
    throw AppError.tenantNotResolved("Token de sessão inválido");
  }
}
