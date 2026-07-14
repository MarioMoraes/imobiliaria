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
