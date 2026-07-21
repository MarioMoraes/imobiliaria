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
