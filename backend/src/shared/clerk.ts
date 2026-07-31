import { createClerkClient, verifyToken } from "@clerk/backend";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";
import { isUuid } from "./uuid.js";

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

/** Convite de organização, reduzido ao que o app precisa. */
export interface OrgInvitation {
  id: string;
  /** Link do ticket de aceite. É ele que vai no e-mail que NÓS enviamos. */
  url: string;
}

/**
 * Convida um e-mail para a organização (= tenant) no Clerk (MOD-AUTH-06). O
 * `publicMetadata` carrega o vínculo (tenant_id/user_id) para auditoria e para
 * um futuro webhook; o vínculo efetivo hoje acontece no 1º login (por e-mail).
 * Lança em falha (ex.: convite pendente duplicado) — o caller decide o rollback.
 *
 * Devolve o `url` do ticket porque a ENTREGA do e-mail é nossa (shared/mailer):
 * a instância de desenvolvimento do Clerk não entrega e-mail.
 */
export async function inviteToOrganization(params: {
  orgId: string;
  email: string;
  role: string;
  /** Para onde o convidado volta depois de aceitar (URL do frontend). */
  redirectUrl?: string;
  publicMetadata?: Record<string, unknown>;
}): Promise<OrgInvitation> {
  const inv = await clerkClient.organizations.createOrganizationInvitation({
    organizationId: params.orgId,
    emailAddress: params.email,
    role: orgRoleFor(params.role),
    redirectUrl: params.redirectUrl,
    publicMetadata: params.publicMetadata,
  });
  return { id: inv.id, url: inv.url ?? "" };
}

/**
 * Convite pendente de um e-mail nesta organização, se houver. Usado no reenvio:
 * um convite ainda válido é reaproveitado (recriar daria erro de duplicado);
 * `null` significa que não há pendente — revogado, expirado ou já aceito — e o
 * caller deve criar um novo.
 */
export async function findPendingInvitation(
  orgId: string,
  email: string,
): Promise<OrgInvitation | null> {
  const list = await clerkClient.organizations.getOrganizationInvitationList({
    organizationId: orgId,
    status: ["pending"],
  });
  const target = email.trim().toLowerCase();
  const found = list.data.find((i) => i.emailAddress.toLowerCase() === target);
  return found ? { id: found.id, url: found.url ?? "" } : null;
}

/**
 * Revoga o convite pendente de um e-mail nesta organização, se houver. Usado ao
 * excluir um funcionário que ainda não aceitou: sem isso o link do ticket
 * continuaria válido e o convidado entraria na org sem `users` row no banco.
 * Devolve `false` quando não havia convite pendente.
 */
export async function revokePendingInvitation(orgId: string, email: string): Promise<boolean> {
  const pending = await findPendingInvitation(orgId, email);
  if (!pending) return false;
  await clerkClient.organizations.revokeOrganizationInvitation({
    organizationId: orgId,
    invitationId: pending.id,
  });
  return true;
}

/**
 * Remove o usuário da organização (= tenant) no Clerk. Complementa a exclusão do
 * funcionário no nosso banco: o membro perde a sessão do tenant no Clerk.
 */
export async function removeOrganizationMember(
  orgId: string,
  clerkUserId: string,
): Promise<void> {
  await clerkClient.organizations.deleteOrganizationMembership({
    organizationId: orgId,
    userId: clerkUserId,
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
  /**
   * Id da organização no Clerk (`org_...`), quando o token tem uma org ativa.
   * Serve de contraprova do `tenant_id`: o backend confere contra
   * `tenants.clerk_org_id` (ver `auth-context.hook.ts`), para que o isolamento
   * não dependa de um único mapeamento de metadata do lado do Clerk.
   */
  orgId?: string;
}

/**
 * Opções comuns de verificação. `authorizedParties` fixa a audiência: sem ele, o
 * `verifyToken` aceita qualquer token de sessão emitido pela nossa instância do
 * Clerk, inclusive um obtido por outro frontend/origem — o cenário clássico de
 * "deputado confuso". A lista é a origem do nosso próprio app.
 */
function verifyOptions() {
  return {
    secretKey: env.CLERK_SECRET_KEY,
    jwtKey: env.CLERK_JWT_KEY,
    authorizedParties: [env.APP_BASE_URL],
  };
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
    const claims = await verifyToken(token, verifyOptions());
    return { userId: claims.sub };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ err }, "falha ao verificar sessão do Clerk");
    throw AppError.tenantNotResolved("Token de sessão inválido");
  }
}

/**
 * Id da organização no token de sessão, nos DOIS formatos que o Clerk emite.
 *
 * O formato v2 (`"v": 2`, atual das instâncias novas) move a organização para um
 * objeto compacto `o: { id, rol, slg }`; o v1 usava `org_id` na raiz. Ler só
 * `org_id` fazia `orgId` sair sempre `undefined` nas sessões v2 — e como a
 * contraprova `assertOrgMatches` só roda quando há `orgId`, ela ficava
 * silenciosamente desligada. Era justamente a defesa que pegaria um claim
 * `tenant_id` apontando para o tenant errado.
 */
function readOrgId(claims: Record<string, unknown>): string | undefined {
  if (typeof claims.org_id === "string") return claims.org_id;
  const org = claims.o;
  if (org && typeof org === "object" && typeof (org as { id?: unknown }).id === "string") {
    return (org as { id: string }).id;
  }
  return undefined;
}

export async function verifyClerkToken(token: string): Promise<ClerkAuth> {
  if (!env.CLERK_SECRET_KEY && !env.CLERK_JWT_KEY) {
    // Sem chaves configuradas não há como validar um Bearer real.
    throw AppError.tenantNotResolved("Clerk não configurado (defina CLERK_SECRET_KEY)");
  }
  try {
    const claims = await verifyToken(token, verifyOptions());
    const tenantId = typeof claims.tenant_id === "string" ? claims.tenant_id : undefined;
    // Erro DISTINTO de "token inválido": a identidade foi verificada, só falta a
    // organização. É o único caso que o dev-mode pode complementar com header.
    if (!tenantId) throw AppError.tenantClaimMissing();
    // O claim é config do lado do Clerk (JWT template) — tratamos como entrada
    // não confiável: sem UUID válido, o RLS só quebraria no primeiro SELECT.
    if (!isUuid(tenantId)) {
      logger.warn({ tenantId }, "claim tenant_id não é um UUID");
      throw AppError.tenantNotResolved("Claim tenant_id inválido");
    }
    return { tenantId, userId: claims.sub, orgId: readOrgId(claims) };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ err }, "falha ao verificar token do Clerk");
    throw AppError.tenantNotResolved("Token de sessão inválido");
  }
}
