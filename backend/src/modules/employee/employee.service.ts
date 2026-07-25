import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { logger } from "../../shared/logger.js";
import {
  findPendingInvitation,
  inviteToOrganization,
  isClerkConfigured,
  removeOrganizationMember,
  revokePendingInvitation,
  type OrgInvitation,
} from "../../shared/clerk.js";
import { isMailerConfigured, sendEmail } from "../../shared/mailer.js";
import { env } from "../../config/env.js";
import { inviteHtml, inviteSubject, inviteText } from "./invite-email.js";
import { findTenantById } from "../tenant/tenant.repository.js";
import * as rbac from "../rbac/rbac.service.js";
import { findUserRef } from "../user/user.repository.js";
import * as repo from "./employee.repository.js";
import type {
  CreateEmployeeInput,
  Employee,
  EmployeeAccessStatus,
  UpdateEmployeeInput,
} from "./employee.schema.js";

/**
 * Regras de negócio de Funcionários (MOD-FUNC). Estende o MOD-AUTH: cada
 * funcionário é um `user` com papel(is). Faz cumprir a proteção do "último
 * ADMIN" (RN-01) e mantém o cache de RBAC coerente após mudanças de papel/acesso.
 */

const ERR_NOT_FOUND = new AppError("ERR_FUNC_001", 404, "Funcionário não encontrado");
const ERR_LAST_ADMIN = new AppError(
  "ERR_FUNC_005",
  409,
  "Não é possível remover o último administrador do tenant",
);

export function list(tenantId: string): Promise<Employee[]> {
  return repo.listEmployees(tenantId);
}

export async function getById(tenantId: string, id: string): Promise<Employee> {
  const employee = await repo.findEmployee(tenantId, id);
  if (!employee) throw ERR_NOT_FOUND;
  return employee;
}

export async function create(
  tenantId: string,
  input: CreateEmployeeInput,
): Promise<Employee> {
  if (await repo.findByCpf(tenantId, input.cpf)) {
    throw new AppError("ERR_FUNC_004", 409, "CPF já cadastrado neste tenant", {
      field: "cpf",
      hint: "unifique a identidade sob o mesmo usuário",
    });
  }
  if (await repo.findUserByEmail(tenantId, input.email)) {
    throw new AppError("ERR_FUNC_004", 409, "E-mail já cadastrado neste tenant", {
      field: "email",
    });
  }

  // Com Clerk configurado e org do tenant conhecida, o membro nasce 'invited' e
  // recebe o convite da organização por e-mail; o vínculo (clerk_external_id)
  // acontece no 1º login (claim por e-mail no auth-context.hook). Sem Clerk
  // (dev), mantém o fluxo antigo: nasce 'active', sem convite.
  const tenant = await findTenantById(tenantId);
  const willInvite = isClerkConfigured() && Boolean(tenant?.clerkOrgId);

  // Clerk ativo mas o tenant não tem org vinculada: o convite seria pulado em
  // silêncio (membro nasceria 'active' sem e-mail). Estado inconsistente —
  // tenants via onboarding sempre gravam clerk_org_id. Torna o gap visível.
  if (isClerkConfigured() && !tenant?.clerkOrgId) {
    logger.warn(
      { tenantId },
      "Clerk configurado mas tenant sem clerk_org_id — convite não será enviado",
    );
  }

  const employee = await repo.insertEmployee(tenantId, input, willInvite ? "invited" : "active");

  if (willInvite) {
    let invitation: OrgInvitation;
    try {
      invitation = await inviteToOrganization({
        orgId: tenant!.clerkOrgId!,
        email: employee.email,
        role: primaryRole(employee.roles),
        redirectUrl: inviteRedirectUrl(),
        publicMetadata: { tenant_id: tenantId, user_id: employee.userId },
      });
    } catch (err) {
      // Sem convite não há como o membro entrar — desfaz o cadastro para o
      // admin poder reenviar (ex.: já existe convite pendente para este e-mail).
      await repo
        .removeEmployee(tenantId, employee.id, employee.userId)
        .catch((e) => logger.error({ e, employeeId: employee.id }, "falha ao desfazer funcionário órfão"));
      logger.warn({ err, email: employee.email }, "falha ao criar convite no Clerk");
      throw new AppError("ERR_FUNC_006", 502, "Não foi possível enviar o convite ao membro", {
        hint: "verifique se já existe um convite pendente para este e-mail",
      });
    }

    // Falha de ENTREGA não desfaz o cadastro (ao contrário da falha acima): o
    // convite existe e é válido, e a UI oferece "reenviar"/"copiar link".
    // Fazer rollback aqui destruiria um convite bom por um problema de e-mail.
    await deliverInvite(tenant!.name, employee.fullName, employee.email, invitation.url);
  }

  await publish({
    type: "employee.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { employeeId: employee.id, userId: employee.userId, roles: employee.roles },
  });

  return employee;
}

export interface ResendInviteResult {
  /** Link do ticket de aceite — a UI oferece copiar quando o e-mail não sai. */
  url: string;
  emailSent: boolean;
}

/**
 * Reenvia o convite de um membro que ainda não aceitou (MOD-FUNC). Reaproveita
 * o convite pendente quando existe; se o anterior foi revogado ou expirou, cria
 * um novo. Devolve o link SEMPRE — mesmo com `emailSent: false`, o admin
 * consegue repassar o acesso por outro canal.
 */
export async function resendInvite(tenantId: string, id: string): Promise<ResendInviteResult> {
  const employee = await repo.findEmployee(tenantId, id);
  if (!employee) throw ERR_NOT_FOUND;

  if (employee.userStatus !== "invited") {
    throw new AppError("ERR_FUNC_007", 409, "Este membro já aceitou o convite", {
      hint: "só é possível reenviar convites pendentes",
    });
  }

  const tenant = await findTenantById(tenantId);
  if (!isClerkConfigured() || !tenant?.clerkOrgId) {
    throw new AppError("ERR_FUNC_008", 409, "Convites indisponíveis: tenant sem organização no Clerk");
  }

  let invitation: OrgInvitation | null;
  try {
    invitation = await findPendingInvitation(tenant.clerkOrgId, employee.email);
    if (!invitation) {
      invitation = await inviteToOrganization({
        orgId: tenant.clerkOrgId,
        email: employee.email,
        role: primaryRole(employee.roles),
        redirectUrl: inviteRedirectUrl(),
        publicMetadata: { tenant_id: tenantId, user_id: employee.userId },
      });
    }
  } catch (err) {
    logger.warn({ err, email: employee.email }, "falha ao recriar convite no Clerk");
    throw new AppError("ERR_FUNC_006", 502, "Não foi possível gerar o convite ao membro");
  }

  const emailSent = await deliverInvite(
    tenant.name,
    employee.fullName,
    employee.email,
    invitation.url,
  );
  return { url: invitation.url, emailSent };
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateEmployeeInput,
): Promise<Employee> {
  const current = await repo.findEmployee(tenantId, id);
  if (!current) throw ERR_NOT_FOUND;

  // Rebaixar o único ADMIN ativo deixaria o tenant sem administrador.
  if (input.roles !== undefined && !input.roles.includes("ADMIN")) {
    await assertNotOrphaningAdmins(tenantId, current);
  }

  const updated = await repo.updateEmployee(tenantId, id, current.userId, input);

  if (input.roles !== undefined) {
    await invalidateAndAnnounce(tenantId, updated, "role.changed", { roles: updated.roles });
  }
  return updated;
}

export async function changeAccess(
  tenantId: string,
  id: string,
  status: EmployeeAccessStatus,
): Promise<Employee> {
  const current = await repo.findEmployee(tenantId, id);
  if (!current) throw ERR_NOT_FOUND;

  if (status !== "ATIVO") {
    await assertNotOrphaningAdmins(tenantId, current);
  }

  const updated = await repo.setAccessStatus(tenantId, id, current.userId, status);

  const eventType =
    status === "REVOGADO"
      ? "employee.access_revoked"
      : status === "SUSPENSO"
        ? "employee.suspended"
        : "employee.reactivated";
  await invalidateAndAnnounce(tenantId, updated, eventType, { accessStatus: status });

  return updated;
}

/**
 * Exclui o funcionário: apaga `employees` + `users` + `user_roles` (a identidade
 * inteira) e, com Clerk ativo, tira o membro da organização — convite pendente é
 * revogado, membro já aceito perde o vínculo com o tenant. A regra do último
 * ADMIN (RN-01) vale aqui como na revogação: excluir também deixaria o tenant
 * sem administrador.
 *
 * A limpeza no Clerk é best-effort e acontece DEPOIS do banco: se ela falhar, o
 * funcionário já não existe para o app (o login não acha `users` row) e o admin
 * pode remover o membro pelo painel do Clerk — o inverso (Clerk limpo, linha
 * órfã no banco) daria um colaborador fantasma na lista.
 */
export async function remove(tenantId: string, id: string): Promise<void> {
  const employee = await repo.findEmployee(tenantId, id);
  if (!employee) throw ERR_NOT_FOUND;

  await assertNotOrphaningAdmins(tenantId, employee);

  const ref = await findUserRef(tenantId, employee.userId);
  await repo.removeEmployee(tenantId, employee.id, employee.userId);

  if (ref?.clerkExternalId) await rbac.invalidate(tenantId, ref.clerkExternalId);

  const tenant = await findTenantById(tenantId);
  if (isClerkConfigured() && tenant?.clerkOrgId) {
    try {
      if (employee.userStatus === "invited") {
        await revokePendingInvitation(tenant.clerkOrgId, employee.email);
      }
      if (ref?.clerkExternalId) {
        await removeOrganizationMember(tenant.clerkOrgId, ref.clerkExternalId);
      }
    } catch (err) {
      logger.warn(
        { err, employeeId: id, email: employee.email },
        "funcionário excluído, mas a limpeza no Clerk falhou",
      );
    }
  }

  await publish({
    type: "employee.deleted",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { employeeId: employee.id, userId: employee.userId },
  });
}

/**
 * Entrega o e-mail do convite. Nunca lança: a entrega é o elo mais frágil do
 * fluxo (provedor fora do ar, domínio não verificado) e o convite continua
 * válido sem ela. Devolve se saiu, para a UI poder oferecer o link.
 */
async function deliverInvite(
  tenantName: string,
  memberName: string,
  email: string,
  acceptUrl: string,
): Promise<boolean> {
  if (!isMailerConfigured()) {
    logger.warn({ email }, "RESEND_API_KEY ausente — convite criado sem envio de e-mail");
    return false;
  }
  // Sem link não há o que enviar (o Clerk devolveria url vazio só em caso
  // anômalo); mandar um e-mail com botão morto é pior que não mandar.
  if (!acceptUrl) {
    logger.warn({ email }, "convite do Clerk sem url de aceite — e-mail não enviado");
    return false;
  }

  const input = { tenantName, memberName, acceptUrl };
  try {
    await sendEmail({
      to: email,
      subject: inviteSubject(tenantName),
      html: inviteHtml(input),
      text: inviteText(input),
    });
    return true;
  } catch (err) {
    logger.warn({ err, email }, "falha ao entregar o e-mail de convite");
    return false;
  }
}

/**
 * Para onde o convidado volta depois de clicar em "aceitar" no e-mail. TEM de
 * ser a página que consome o `__clerk_ticket` (o Clerk anexa o ticket a esta
 * URL): cair na landing "/" faz o link parecer funcionar e não acontecer nada —
 * o ticket nunca é trocado e o convite fica pendente para sempre.
 */
function inviteRedirectUrl(): string {
  return `${env.APP_BASE_URL.replace(/\/+$/, "")}/aceitar-convite`;
}

/**
 * Papel de maior privilégio do membro — define o papel na org do Clerk (admin
 * vs member). Os papéis reais do app continuam em `user_roles` no nosso banco.
 */
function primaryRole(roles: string[]): string {
  return roles.includes("ADMIN") ? "ADMIN" : (roles[0] ?? "GESTOR");
}

/** Bloqueia a transição se ela removeria o único ADMIN ativo do tenant (RN-01). */
async function assertNotOrphaningAdmins(tenantId: string, current: Employee): Promise<void> {
  const isActiveAdmin = current.accessStatus === "ATIVO" && current.roles.includes("ADMIN");
  if (!isActiveAdmin) return;
  if ((await repo.countActiveAdmins(tenantId)) <= 1) throw ERR_LAST_ADMIN;
}

/**
 * Invalida o cache de RBAC do usuário (se vinculado ao Clerk) e publica o evento
 * correspondente. Mudanças de papel/acesso precisam valer imediatamente.
 */
async function invalidateAndAnnounce(
  tenantId: string,
  employee: Employee,
  type: string,
  extra: Record<string, unknown>,
): Promise<void> {
  const ref = await findUserRef(tenantId, employee.userId);
  if (ref?.clerkExternalId) await rbac.invalidate(tenantId, ref.clerkExternalId);

  await publish({
    type,
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { employeeId: employee.id, userId: employee.userId, ...extra },
  });
}
