"use server";

import { revalidatePath } from "next/cache";
import { deleteJson, sendJson } from "../../../lib/api";

export interface SettingsResult {
  ok: boolean;
  error?: string;
}

const PATH = "/configuracoes";

/**
 * Conecta/atualiza a conta ZapSign do tenant. O token só trafega daqui para o
 * backend, que o valida contra a API e o guarda cifrado — nunca volta na
 * leitura (a tela mostra apenas os últimos 4 caracteres).
 */
export async function saveSignatureSettingsAction(input: {
  apiToken: string;
  sandbox: boolean;
  authMode: string;
}): Promise<SettingsResult> {
  const token = input.apiToken.trim();
  const res = await sendJson("PUT", "/v1/signature-settings", {
    // Vazio = manter o token atual (o usuário só mudou sandbox/modo).
    ...(token ? { apiToken: token } : {}),
    sandbox: input.sandbox,
    authMode: input.authMode,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function disconnectSignatureAction(): Promise<SettingsResult> {
  const res = await deleteJson("/v1/signature-settings");
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Conecta/atualiza a conta Asaas do tenant. A chave só trafega daqui para o
 * backend, que a valida contra a API e a guarda cifrada — nunca volta na
 * leitura (a tela mostra apenas os últimos 4 caracteres).
 */
export async function savePaymentSettingsAction(input: {
  apiKey: string;
  sandbox: boolean;
  billingType: string;
}): Promise<SettingsResult> {
  const apiKey = input.apiKey.trim();
  const res = await sendJson("PUT", "/v1/payment-settings", {
    // Vazio = manter a chave atual (o usuário só mudou sandbox/forma).
    ...(apiKey ? { apiKey } : {}),
    sandbox: input.sandbox,
    billingType: input.billingType,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function disconnectPaymentAction(): Promise<SettingsResult> {
  const res = await deleteJson("/v1/payment-settings");
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Cadastro da própria imobiliária (nome, CNPJ, CRECI, subdomínio e logo). Vai para
 * `/v1/tenant`, que resolve o tenant pela sessão — não há id na URL, então um
 * admin não alcança o cadastro de outra imobiliária.
 *
 * O logo trafega como data URL (Fase 0, coluna `tenants.logo_url`), já
 * redimensionado no cliente. `null` remove o logo.
 */
export async function saveTenantProfileAction(input: {
  name: string;
  cnpj: string;
  creci: string;
  slug: string;
  logoUrl?: string | null;
}): Promise<SettingsResult> {
  const cnpj = input.cnpj.replace(/\D/g, "");
  const res = await sendJson("PATCH", "/v1/tenant", {
    name: input.name.trim(),
    cnpj: cnpj || null,
    creci: input.creci.trim() || null,
    // Só o slug é editável; o domínio é fixo (ver TENANT_DOMAIN).
    slug: input.slug,
    ...(input.logoUrl === undefined ? {} : { logoUrl: input.logoUrl }),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  // O logo e o nome aparecem na sidebar/topbar, montadas no layout.
  revalidatePath("/", "layout");
  return { ok: true };
}
