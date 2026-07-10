"use server";

import { revalidatePath } from "next/cache";
import { postJson } from "../../../lib/api";

export interface FormState {
  ok?: boolean;
  error?: string;
}

export async function createGuarantorAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const s = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };

  const payload = {
    personType: s("personType") ?? "PF",
    cpfCnpj: s("cpfCnpj"),
    fullName: s("fullName"),
    maritalStatus: s("maritalStatus"),
    spouseName: s("spouseName"),
    occupation: s("occupation"),
    email: s("email"),
    mobile: s("mobile"),
    addresses: s("city")
      ? [{ kind: "RESIDENCIAL" as const, city: s("city"), state: s("state") }]
      : [],
  };

  if (!payload.cpfCnpj || !payload.fullName) {
    return { ok: false, error: "Informe ao menos nome e CPF/CNPJ." };
  }

  const res = await postJson("/v1/guarantors", payload);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/fiadores");
  return { ok: true };
}
