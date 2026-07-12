"use server";

import { auth } from "@clerk/nextjs/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";

export interface OnboardingStudio {
  name: string;
  cnpj: string;
  creci?: string;
  slug: string;
  planId?: string;
}

export type OnboardingResult =
  | { ok: true; clerkOrgId: string | null; tenantId: string }
  | { ok: false; error: string };

/**
 * Submete o onboarding ao backend com o token da sessão Clerk (o usuário já fez
 * sign-up). O backend cria a Organização no Clerk + o tenant e devolve o
 * `clerkOrgId`, que o cliente usa em `setActive(org)`.
 */
export async function submitOnboarding(studio: OnboardingStudio): Promise<OnboardingResult> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) return { ok: false, error: "Sessão expirada. Faça login novamente." };

  try {
    const res = await fetch(`${BACKEND_URL}/v1/auth/onboarding`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        studio: {
          name: studio.name,
          cnpj: studio.cnpj,
          creci: studio.creci || undefined,
          slug: studio.slug,
        },
        planId: studio.planId || "free",
      }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { clerkOrgId: string | null; tenant: { id: string } };
      error?: { message?: string };
    };
    if (!res.ok || !json.data) {
      return { ok: false, error: json.error?.message ?? `Erro ${res.status}` };
    }
    return { ok: true, clerkOrgId: json.data.clerkOrgId, tenantId: json.data.tenant.id };
  } catch {
    return { ok: false, error: "Backend indisponível. Tente novamente." };
  }
}
