"use server";

import { revalidatePath } from "next/cache";
import { deleteJson, patchJson, postJson } from "../../../lib/api";

const PATH = "/corretores";

/** Shape do formulário no client (tudo string; conversão acontece aqui). */
export interface BrokerFormInput {
  name: string;
  address: string;
  district: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  mobile: string;
  cpf: string;
  rg: string;
  commissionPercent: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** "10,5" | "10.5" | "" → número 0–100 (0 se vazio/ inválido). */
function toPercent(v: string): number {
  const n = Number(v.trim().replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** Monta o payload da API. `nullable` limpa o campo quando vazio (no update). */
function toPayload(input: BrokerFormInput, nullable: boolean) {
  const opt = (v: string) => (v.trim() ? v.trim() : nullable ? null : undefined);
  return {
    name: input.name.trim(),
    address: opt(input.address),
    district: opt(input.district),
    city: opt(input.city),
    state: opt(input.state),
    zip: opt(input.zip),
    phone: opt(input.phone),
    mobile: opt(input.mobile),
    cpf: opt(input.cpf),
    rg: opt(input.rg),
    commissionPercent: toPercent(input.commissionPercent),
  };
}

export async function createBrokerAction(input: BrokerFormInput): Promise<ActionResult> {
  if (input.name.trim().length < 2) {
    return { ok: false, error: "Informe o nome do corretor." };
  }
  const res = await postJson("/v1/brokers", toPayload(input, false));
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateBrokerAction(
  id: string,
  input: BrokerFormInput,
): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  if (input.name.trim().length < 2) {
    return { ok: false, error: "Informe o nome do corretor." };
  }
  const res = await patchJson(`/v1/brokers/${id}`, toPayload(input, true));
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteBrokerAction(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/brokers/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}
