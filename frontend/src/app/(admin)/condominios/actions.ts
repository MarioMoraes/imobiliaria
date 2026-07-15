"use server";

import { revalidatePath } from "next/cache";
import { deleteJson, patchJson, postJson } from "../../../lib/api";

const PATH = "/condominios";

/** Shape do formulário no client (tudo string; conversão acontece aqui). */
export interface CondominiumFormInput {
  name: string;
  address: string;
  number: string;
  district: string;
  zip: string;
  city: string;
  state: string;
  adminFeePercent: string;
  adminFeeFixedReais: string;
  interestPercent: string;
  penaltyPercent: string;
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

/** "10,5" | "10.5" | "" → número (0 se vazio/ inválido). */
function toPercent(v: string): number {
  const n = Number(v.trim().replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** Monta o payload da API a partir do formulário. */
function toPayload(input: CondominiumFormInput) {
  return {
    name: input.name.trim(),
    address: input.address.trim() || undefined,
    number: input.number.trim() || undefined,
    district: input.district.trim() || undefined,
    zip: input.zip.trim() || undefined,
    city: input.city.trim() || undefined,
    state: input.state.trim() || undefined,
    adminFeePercent: toPercent(input.adminFeePercent),
    adminFeeFixedCents: reaisToCents(input.adminFeeFixedReais),
    interestPercent: toPercent(input.interestPercent),
    penaltyPercent: toPercent(input.penaltyPercent),
  };
}

export async function createCondominiumAction(
  input: CondominiumFormInput,
): Promise<ActionResult> {
  if (input.name.trim().length < 2) {
    return { ok: false, error: "Informe o nome do condomínio." };
  }
  const res = await postJson("/v1/condominiums", toPayload(input));
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateCondominiumAction(
  id: string,
  input: CondominiumFormInput,
): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  if (input.name.trim().length < 2) {
    return { ok: false, error: "Informe o nome do condomínio." };
  }
  const res = await patchJson(`/v1/condominiums/${id}`, toPayload(input));
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteCondominiumAction(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/condominiums/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}
