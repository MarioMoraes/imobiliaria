"use server";

import { revalidatePath } from "next/cache";
import { deleteJson, patchJson, postJson } from "../../../lib/api";

const PATH = "/financeiro";

/** Resultado de uma ação (chamada programática via useTransition no client). */
export interface BankActionResult {
  ok: boolean;
  error?: string;
}

/** Shape do formulário de banco no client. O código é auto-incremento (backend). */
export interface BankFormInput {
  name: string;
  agency: string;
  accountNumber: string;
  favorite: boolean;
}

/**
 * Campos editáveis enviados ao backend. O `code` NÃO vai: na inclusão o backend
 * atribui o próximo automaticamente e, na edição, ele é imutável (identificador).
 * Os saldos também ficam de fora — são alimentados por outras rotinas.
 */
function toPayload(input: BankFormInput) {
  return {
    name: input.name.trim(),
    agency: input.agency.trim(),
    accountNumber: input.accountNumber.trim(),
    favorite: input.favorite,
  };
}

export async function createBankAction(input: BankFormInput): Promise<BankActionResult> {
  if (input.name.trim().length < 1) {
    return { ok: false, error: "Informe o nome do banco." };
  }
  const res = await postJson("/v1/banks", toPayload(input));
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateBankAction(
  id: string,
  input: BankFormInput,
): Promise<BankActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  if (input.name.trim().length < 1) {
    return { ok: false, error: "Informe o nome do banco." };
  }
  const res = await patchJson(`/v1/banks/${id}`, toPayload(input));
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteBankAction(id: string): Promise<BankActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/banks/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

/* ------------------------------ Repasse ao proprietário (contas a pagar) */

/**
 * As telas de repasse são subpáginas, e `revalidatePath` não alcança filhas: sem
 * revalidar as duas explicitamente, dar baixa num repasse deixava o card do
 * financeiro mostrando o número antigo.
 */
const PAYABLE_PATHS = ["/financeiro", "/financeiro/proprietarios", "/financeiro/gestao"];

function revalidatePayables(): void {
  for (const path of PAYABLE_PATHS) revalidatePath(path);
}

export interface PayableActionResult {
  ok: boolean;
  error?: string;
}

/** Baixa do repasse: o dinheiro saiu para o proprietário. */
export async function settlePayableAction(
  id: string,
  paidAt?: string,
): Promise<PayableActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await postJson(`/v1/payables/${id}/settle`, paidAt ? { paidAt } : {});
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePayables();
  return { ok: true };
}

export async function cancelPayableAction(id: string): Promise<PayableActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await postJson(`/v1/payables/${id}/cancel`, {});
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePayables();
  return { ok: true };
}

/**
 * Envia o repasse por PIX pelo Asaas. A transferência é assíncrona: o repasse
 * fica "Processando" e só vira "Pago" quando o banco confirma (webhook, ou o
 * botão de sincronizar em desenvolvimento).
 */
export async function transferPayoutAction(id: string): Promise<PayableActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await postJson(`/v1/payables/${id}/transfer`, {});
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePayables();
  return { ok: true };
}

/** Consulta o Asaas e aplica o desfecho — o webhook não alcança o localhost. */
export async function syncTransferAction(id: string): Promise<PayableActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await postJson(`/v1/payables/${id}/sync-transfer`, {});
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePayables();
  return { ok: true };
}

export interface GeneratePayoutsResult extends PayableActionResult {
  /** Aluguéis pagos que estavam sem repasse. */
  scanned?: number;
  /** Repasses efetivamente criados. */
  created?: number;
}

/**
 * Reconciliação: gera os repasses de aluguéis já pagos que ficaram sem
 * lançamento (proprietário cadastrado depois da baixa, aluguel quitado antes de
 * o módulo existir). Seguro repetir — o backend não duplica.
 */
export async function generatePayoutsAction(): Promise<GeneratePayoutsResult> {
  const res = await postJson("/v1/payables/generate", {});
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePayables();
  const data = res.data as { scanned?: number; created?: number } | undefined;
  return { ok: true, scanned: data?.scanned ?? 0, created: data?.created ?? 0 };
}
