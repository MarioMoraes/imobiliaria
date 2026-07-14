"use server";

import { revalidatePath } from "next/cache";
import { postJson } from "../../../lib/api";
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
