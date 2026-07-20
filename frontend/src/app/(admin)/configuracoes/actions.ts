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
