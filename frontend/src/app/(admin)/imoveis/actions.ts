"use server";

import { revalidatePath } from "next/cache";
import { postJson } from "../../../lib/api";

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
