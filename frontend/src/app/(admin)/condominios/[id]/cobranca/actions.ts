"use server";

import { revalidatePath } from "next/cache";
import {
  backendNotice,
  fetchCondoBilling,
  postJson,
  type CondoBillingPreview,
} from "../../../../../lib/api";

export interface BillingFormInput {
  condominiumId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  dueDate: string;
}

export type BillingResult =
  | { ok: true; preview: CondoBillingPreview }
  | { ok: false; error: string };

/** Validação comum às duas ações — o backend revalida, isto é só para a UI. */
function invalid(input: BillingFormInput): string | null {
  if (!input.condominiumId) return "Escolha o condomínio.";
  if (!input.periodStart || !input.periodEnd) return "Informe o período.";
  if (input.periodEnd < input.periodStart) return "O fim do período é anterior ao início.";
  if (!input.dueDate) return "Informe o vencimento.";
  return null;
}

/** Calcula a cobrança sem gravar nada (prévia para conferência). */
export async function previewBillingAction(input: BillingFormInput): Promise<BillingResult> {
  const problem = invalid(input);
  if (problem) return { ok: false, error: problem };

  const preview = await fetchCondoBilling(input.condominiumId, {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    dueDate: input.dueDate,
  });
  // `fetch*` devolve null em qualquer falha, mas classifica a causa no request —
  // `backendNotice()` é o que diz se foi offline, sessão ou permissão.
  if (preview === null) {
    return { ok: false, error: backendNotice() ?? "Não foi possível calcular a cobrança." };
  }
  return { ok: true, preview };
}

/** Grava as contas a receber. O backend recalcula tudo — o valor não vem daqui. */
export async function generateBillingAction(input: BillingFormInput): Promise<BillingResult> {
  const problem = invalid(input);
  if (problem) return { ok: false, error: problem };

  const res = await postJson(`/v1/condominiums/${input.condominiumId}/billing`, {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    dueDate: input.dueDate,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/financeiro/gestao");
  return { ok: true, preview: res.data as CondoBillingPreview };
}
