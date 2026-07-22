"use server";

import { revalidatePath } from "next/cache";
import { deleteJson, patchJson, postJson } from "../../../lib/api";

const PATH = "/financeiro";

/** Resultado de uma ação (chamada programática via useTransition no client). */
export interface BankActionResult {
  ok: boolean;
  error?: string;
}

/** Shape do formulário de banco no client. O código é auto-incremento (backend). */
export interface BankFormInput {
  name: string;
  agency: string;
  accountNumber: string;
  favorite: boolean;
}

/**
 * Campos editáveis enviados ao backend. O `code` NÃO vai: na inclusão o backend
 * atribui o próximo automaticamente e, na edição, ele é imutável (identificador).
 * Os saldos também ficam de fora — são alimentados por outras rotinas.
 */
function toPayload(input: BankFormInput) {
  return {
    name: input.name.trim(),
    agency: input.agency.trim(),
    accountNumber: input.accountNumber.trim(),
    favorite: input.favorite,
  };
}

export async function createBankAction(input: BankFormInput): Promise<BankActionResult> {
  if (input.name.trim().length < 1) {
    return { ok: false, error: "Informe o nome do banco." };
  }
  const res = await postJson("/v1/banks", toPayload(input));
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateBankAction(
  id: string,
  input: BankFormInput,
): Promise<BankActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  if (input.name.trim().length < 1) {
    return { ok: false, error: "Informe o nome do banco." };
  }
  const res = await patchJson(`/v1/banks/${id}`, toPayload(input));
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteBankAction(id: string): Promise<BankActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/banks/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}
