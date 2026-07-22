"use server";

import { revalidatePath } from "next/cache";
import { deleteJson, patchJson, postJson } from "../../../../../lib/api";

/** Shape do formulário no client (tudo string; conversão acontece aqui). */
export interface ExpenseFormInput {
  entryDate: string; // YYYY-MM-DD
  eventId: string;
  valueReais: string;
  notes: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** "1.234,56" | "1234.56" | "" → centavos (0 se vazio/ inválido). */
function reaisToCents(v: string): number {
  const normalized = v.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

export async function createExpenseAction(
  condominiumId: string,
  input: ExpenseFormInput,
): Promise<ActionResult> {
  if (!condominiumId) return { ok: false, error: "Condomínio inválido." };

  const amountCents = reaisToCents(input.valueReais);
  if (amountCents <= 0) return { ok: false, error: "Informe um valor maior que zero." };

  const payload = {
    entryDate: input.entryDate.trim() || undefined,
    eventId: input.eventId.trim() || undefined,
    amountCents,
    notes: input.notes.trim() || undefined,
  };

  const res = await postJson(`/v1/condominiums/${condominiumId}/expenses`, payload);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/condominios/${condominiumId}/despesas`);
  return { ok: true };
}

export async function updateExpenseAction(
  condominiumId: string,
  expenseId: string,
  input: ExpenseFormInput,
): Promise<ActionResult> {
  if (!condominiumId || !expenseId) return { ok: false, error: "ID inválido." };

  const amountCents = reaisToCents(input.valueReais);
  if (amountCents <= 0) return { ok: false, error: "Informe um valor maior que zero." };

  // `null` limpa Evento/Histórico quando o usuário esvazia o campo.
  const payload = {
    entryDate: input.entryDate.trim() || null,
    eventId: input.eventId.trim() || null,
    amountCents,
    notes: input.notes.trim() || null,
  };

  const res = await patchJson(`/v1/condominiums/${condominiumId}/expenses/${expenseId}`, payload);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/condominios/${condominiumId}/despesas`);
  return { ok: true };
}

export async function deleteExpenseAction(
  condominiumId: string,
  expenseId: string,
): Promise<ActionResult> {
  if (!condominiumId || !expenseId) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/condominiums/${condominiumId}/expenses/${expenseId}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/condominios/${condominiumId}/despesas`);
  return { ok: true };
}
