"use server";

import { revalidatePath } from "next/cache";
import { postJson } from "../../../../../lib/api";

export interface BoletoResult {
  ok: boolean;
  error?: string;
  /** Link a abrir: o PDF do boleto quando existe, senão a fatura (boleto + PIX). */
  url?: string;
  /** Id da cobrança no provedor — é o que marca a linha como já emitida. */
  asaasChargeId?: string;
  boletoUrl?: string;
  invoiceUrl?: string;
}

/**
 * Emite (ou recupera) a cobrança da conta de condomínio no Asaas e devolve o
 * link para impressão. Idempotente no backend: cobrança já emitida devolve o
 * link existente sem tocar no provedor.
 */
export async function issueCondoBoletoAction(receivableId: string): Promise<BoletoResult> {
  const res = await postJson(`/v1/receivables/${receivableId}/boleto`, {});
  if (!res.ok) return { ok: false, error: res.error };

  const charge = res.data as {
    url?: string;
    asaasChargeId?: string;
    boletoUrl?: string | null;
    invoiceUrl?: string | null;
  };
  if (!charge?.url) return { ok: false, error: "Boleto emitido, mas sem URL de acesso." };

  return {
    ok: true,
    url: charge.url,
    asaasChargeId: charge.asaasChargeId,
    boletoUrl: charge.boletoUrl ?? undefined,
    invoiceUrl: charge.invoiceUrl ?? undefined,
  };
}

/**
 * Consulta o Asaas e aplica o estado atual da cobrança: pago lá vira baixa
 * aqui, e a baixa entra no saldo do condomínio.
 *
 * Em produção quem faz isso é o webhook do provedor, sozinho. Este é o caminho
 * manual — indispensável em desenvolvimento, onde o Asaas não alcança
 * `localhost` e a baixa nunca chegaria.
 */
export async function syncCondoChargeAction(
  condominiumId: string,
  receivableId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await postJson(`/v1/receivables/${receivableId}/sync-charge`, {});
  if (!res.ok) return { ok: false, error: res.error };

  // O saldo do condomínio é derivado das baixas: revalidar as duas telas evita
  // que ele fique mostrando o valor de antes do pagamento.
  revalidatePath(`/condominios/${condominiumId}`);
  revalidatePath(`/condominios/${condominiumId}/condominos`);
  return { ok: true };
}
