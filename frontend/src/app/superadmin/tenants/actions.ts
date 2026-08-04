"use server";

import { revalidatePath } from "next/cache";
import { postJson, patchJson } from "../../../lib/api";

export interface TenantInput {
  /** Presente = edição; ausente = criação. */
  id?: string;
  name: string;
  slug: string;
  domain?: string;
  plan: string;
  /** data URL do logo, ou null para remover. */
  logoUrl?: string | null;
}

export interface FormState {
  ok?: boolean;
  error?: string;
}

/**
 * Cria ou atualiza um tenant (Super Admin) via /admin/tenants.
 * Na edição o slug não muda (o backend não aceita alteração de slug).
 */
export async function saveTenantAction(input: TenantInput): Promise<FormState> {
  const name = input.name.trim();
  if (name.length < 2) return { ok: false, error: "Informe o nome da imobiliária." };

  if (input.id) {
    const res = await patchJson(`/admin/tenants/${input.id}`, {
      name,
      domain: input.domain?.trim() || null,
      plan: input.plan,
      logoUrl: input.logoUrl ?? null,
    });
    if (!res.ok) return { ok: false, error: res.error };
  } else {
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,}$/.test(slug)) {
      return { ok: false, error: "Slug inválido: use minúsculas, números e hífen." };
    }
    const res = await postJson("/admin/tenants", {
      name,
      slug,
      domain: input.domain?.trim() || undefined,
      plan: input.plan,
      logoUrl: input.logoUrl ?? undefined,
    });
    if (!res.ok) return { ok: false, error: res.error };
  }

  revalidatePath("/superadmin/tenants");
  return { ok: true };
}

/**
 * Recarrega o pacote de créditos de IA de uma imobiliária.
 *
 * Some ao que sobrou (pacote pré-pago), não substitui. É a única forma de um
 * tenant ganhar créditos: até existir esta tela, só o seed concedia, e toda
 * imobiliária criada depois ficava com saldo zero — o assistente respondia
 * "Créditos de IA insuficientes" desde o primeiro dia.
 */
export async function grantCreditsAction(
  tenantId: string,
  amount: number,
): Promise<FormState> {
  if (!tenantId) return { ok: false, error: "Imobiliária inválida." };
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: "Informe uma quantidade de créditos maior que zero." };
  }

  const res = await postJson(`/admin/tenants/${tenantId}/credits`, { amount });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/superadmin/tenants");
  return { ok: true };
}
