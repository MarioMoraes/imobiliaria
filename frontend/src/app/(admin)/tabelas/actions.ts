"use server";

import { revalidatePath } from "next/cache";
import { deleteJson, postJson } from "../../../lib/api";

export interface LookupFormState {
  ok?: boolean;
  error?: string;
}

/** Resultado de uma remoção (chamada programática via useTransition no client). */
export interface DeleteResult {
  ok: boolean;
  error?: string;
}

const PATH = "/tabelas";

/* ------------------------------------------------------ Tipos de imóvel */
export async function createTypeAction(
  _prev: LookupFormState,
  formData: FormData,
): Promise<LookupFormState> {
  const name = formData.get("name");
  if (typeof name !== "string" || name.trim().length < 2) {
    return { ok: false, error: "Informe um nome válido." };
  }
  const res = await postJson("/v1/property-types", { name: name.trim() });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteTypeAction(id: string): Promise<DeleteResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/property-types/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

/* ------------------------------------------------------------ Cláusulas */
export async function createClauseAction(
  _prev: LookupFormState,
  formData: FormData,
): Promise<LookupFormState> {
  const name = formData.get("name");
  const description = formData.get("description");
  if (typeof name !== "string" || name.trim().length < 2) {
    return { ok: false, error: "Informe o nome da cláusula." };
  }
  if (typeof description !== "string" || description.trim().length < 2) {
    return { ok: false, error: "Informe a descrição da cláusula." };
  }
  const res = await postJson("/v1/clauses", {
    name: name.trim(),
    description: description.trim(),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteClauseAction(id: string): Promise<DeleteResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/clauses/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

/* ----------------------------------------------------- Itens de vistoria */
export async function createItemAction(
  _prev: LookupFormState,
  formData: FormData,
): Promise<LookupFormState> {
  const description = formData.get("description");
  if (typeof description !== "string" || description.trim().length < 2) {
    return { ok: false, error: "Informe uma descrição válida." };
  }
  const res = await postJson("/v1/inspection-items", {
    description: description.trim(),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteItemAction(id: string): Promise<DeleteResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/inspection-items/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

/* --------------------------------------------------------------- Bairros */
export async function createDistrictAction(
  _prev: LookupFormState,
  formData: FormData,
): Promise<LookupFormState> {
  const name = formData.get("name");
  if (typeof name !== "string" || name.trim().length < 2) {
    return { ok: false, error: "Informe o nome do bairro." };
  }
  const res = await postJson("/v1/districts", { name: name.trim() });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteDistrictAction(id: string): Promise<DeleteResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/districts/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

/* --------------------------------------------------------------- Eventos */
/** Shape do formulário de evento no client (percentuais como string). */
export interface EventFormInput {
  name: string;
  kind: "DEBITO" | "CREDITO";
  interestPercent: string;
  judicialInterestPercent: string;
  penaltyPercent: string;
  appliesAdminFee: boolean;
}

export interface EventActionResult {
  ok: boolean;
  error?: string;
}

/** "1,000" | "1.000" | "" → número (0 se vazio/ inválido), limitado a 0–100. */
function toPercent(v: string): number {
  const n = Number((v ?? "").trim().replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export async function createEventAction(
  input: EventFormInput,
): Promise<EventActionResult> {
  if (input.name.trim().length < 1) {
    return { ok: false, error: "Informe o nome do evento." };
  }
  const res = await postJson("/v1/events", {
    name: input.name.trim(),
    kind: input.kind === "CREDITO" ? "CREDITO" : "DEBITO",
    interestPercent: toPercent(input.interestPercent),
    judicialInterestPercent: toPercent(input.judicialInterestPercent),
    penaltyPercent: toPercent(input.penaltyPercent),
    appliesAdminFee: input.appliesAdminFee,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteEventAction(id: string): Promise<DeleteResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/events/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}
