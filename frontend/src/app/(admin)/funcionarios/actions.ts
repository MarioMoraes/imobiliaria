"use server";

import { revalidatePath } from "next/cache";
import { deleteJson, patchJson, postJson } from "../../../lib/api";
import { isValidCpf, onlyDigits } from "../../../lib/br-doc";

/** Papéis internos atribuíveis a um funcionário (subconjunto do RBAC). */
export type EmployeeRole = "ADMIN" | "GESTOR" | "FINANCEIRO";

export interface NewEmployeeInput {
  fullName: string;
  email: string;
  cpf: string;
  position: string;
  roles: EmployeeRole[];
  hiredAt?: string;
}

export interface FormState {
  ok?: boolean;
  error?: string;
}

const clean = (v?: string) => {
  const t = (v ?? "").trim();
  return t === "" ? undefined : t;
};

/**
 * Convida um novo membro via POST /v1/employees. O backend cria o funcionário
 * como "invited" e dispara o convite da organização no Clerk (quando
 * configurado); em dev sem Clerk o membro nasce ativo, sem e-mail.
 */
export async function inviteEmployeeAction(input: NewEmployeeInput): Promise<FormState> {
  const fullName = input.fullName.trim();
  if (fullName.length < 2) return { ok: false, error: "Informe o nome do membro." };

  const email = clean(input.email);
  if (!email) return { ok: false, error: "Informe o e-mail para o convite." };

  const position = clean(input.position);
  if (!position) return { ok: false, error: "Informe o cargo." };

  const cpf = onlyDigits(input.cpf);
  if (!isValidCpf(cpf)) return { ok: false, error: "CPF inválido." };

  if (!input.roles || input.roles.length === 0) {
    return { ok: false, error: "Selecione ao menos um papel (RBAC)." };
  }

  const body: Record<string, unknown> = {
    fullName,
    email,
    cpf,
    position,
    roles: input.roles,
    hiredAt: clean(input.hiredAt),
  };

  const res = await postJson("/v1/employees", body);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/funcionarios");
  return { ok: true };
}

export type EmployeeAccessStatus = "ATIVO" | "SUSPENSO" | "REVOGADO";

/** Campos editáveis de um funcionário já cadastrado (nome/e-mail/CPF são fixos). */
export interface EditEmployeeInput {
  position: string;
  roles: EmployeeRole[];
  hiredAt: string;
}

/**
 * Atualiza cargo, papéis e admissão via PATCH /v1/employees/:id. `hiredAt` vazio
 * vira `null` (limpa a data); identidade (nome/e-mail/CPF) não muda por aqui —
 * o backend só aceita esses três campos.
 */
export async function updateEmployeeAction(
  id: string,
  input: EditEmployeeInput,
): Promise<FormState> {
  if (!id) return { ok: false, error: "ID inválido." };

  const position = clean(input.position);
  if (!position) return { ok: false, error: "Informe o cargo." };
  if (!input.roles || input.roles.length === 0) {
    return { ok: false, error: "Selecione ao menos um papel (RBAC)." };
  }

  const res = await patchJson(`/v1/employees/${id}`, {
    position,
    roles: input.roles,
    hiredAt: clean(input.hiredAt) ?? null,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/funcionarios");
  return { ok: true };
}

/** Suspende, reativa ou revoga o acesso (PATCH /v1/employees/:id/access). */
export async function changeAccessAction(
  id: string,
  status: EmployeeAccessStatus,
): Promise<FormState> {
  if (!id) return { ok: false, error: "ID inválido." };

  const res = await patchJson(`/v1/employees/${id}/access`, { status });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/funcionarios");
  return { ok: true };
}

/**
 * Exclui o funcionário (DELETE /v1/employees/:id). O backend apaga a identidade
 * inteira e, com Clerk ativo, tira o membro da organização.
 */
export async function deleteEmployeeAction(id: string): Promise<FormState> {
  if (!id) return { ok: false, error: "ID inválido." };

  const res = await deleteJson(`/v1/employees/${id}`);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/funcionarios");
  return { ok: true };
}

export interface ResendInviteState {
  ok: boolean;
  /** Link do ticket de aceite — sempre volta em caso de sucesso. */
  url?: string;
  /** false = o convite existe, mas o e-mail não saiu (usar o link). */
  emailSent?: boolean;
  error?: string;
}

/**
 * Reenvia o convite de um membro pendente. O backend devolve o link mesmo
 * quando a entrega do e-mail falha, para o admin repassar por outro canal.
 */
export async function resendInviteAction(id: string): Promise<ResendInviteState> {
  const res = await postJson(`/v1/employees/${id}/invite/resend`, {});
  if (!res.ok) return { ok: false, error: res.error };

  const data = res.data as { url?: string; emailSent?: boolean } | undefined;
  revalidatePath("/funcionarios");
  return { ok: true, url: data?.url ?? "", emailSent: data?.emailSent ?? false };
}
