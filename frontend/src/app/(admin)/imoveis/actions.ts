"use server";

import { revalidatePath } from "next/cache";
import { deleteJson, postJson } from "../../../lib/api";

export interface TypeFormState {
  ok?: boolean;
  error?: string;
}

export async function createPropertyTypeAction(
  _prev: TypeFormState,
  formData: FormData,
): Promise<TypeFormState> {
  const name = formData.get("name");
  if (typeof name !== "string" || name.trim().length < 2) {
    return { ok: false, error: "Informe um nome válido." };
  }
  const res = await postJson("/v1/property-types", { name: name.trim() });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/imoveis");
  return { ok: true };
}

export interface OwnerActionResult {
  ok: boolean;
  error?: string;
}

/** Vincula um dono (pessoa LOCADOR) ao imóvel com % de participação. */
export async function addOwnerAction(
  propertyId: string,
  personId: string,
  sharePercent: number,
): Promise<OwnerActionResult> {
  if (!personId) return { ok: false, error: "Selecione um proprietário." };
  const res = await postJson(`/v1/properties/${propertyId}/owners`, {
    personId,
    sharePercent,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/imoveis");
  return { ok: true };
}

/** Desvincula um dono do imóvel. */
export async function removeOwnerAction(
  propertyId: string,
  personId: string,
): Promise<OwnerActionResult> {
  const res = await deleteJson(`/v1/properties/${propertyId}/owners/${personId}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/imoveis");
  return { ok: true };
}
