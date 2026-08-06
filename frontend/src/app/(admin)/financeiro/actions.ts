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
const PAYABLE_PATHS = ["/financeiro", "/financeiro/proprietarios"];

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

/**
 * Um PIX só para vários repasses do mesmo proprietário: o dono vê um crédito no
 * extrato, a imobiliária paga uma tarifa e os lançamentos continuam separados no
 * sistema (todos passam a apontar para a mesma transferência).
 */
export async function transferPayoutBatchAction(
  ids: string[],
): Promise<PayableActionResult> {
  if (!ids.length) return { ok: false, error: "Selecione ao menos um repasse." };
  const res = await postJson("/v1/payables/transfer-batch", { payableIds: ids });
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

/* ------------------------------------ Fluxo de caixa (MOD-FIN) */

/**
 * O extrato tem tela própria e o card do financeiro mostra contadores derivados
 * dele. `revalidatePath` não alcança filhas, então cada caminho vai explícito —
 * mesmo motivo de `PAYABLE_PATHS`.
 */
const CASH_FLOW_PATHS = ["/financeiro", "/financeiro/fluxo-de-caixa"];

function revalidateCashFlow(): void {
  for (const path of CASH_FLOW_PATHS) revalidatePath(path);
}

export interface CashFlowActionResult {
  ok: boolean;
  error?: string;
}

/**
 * "1.234,56" | "1234.56" | "" → centavos | null. Mesma conversão de
 * `imoveis/actions.ts`: o formulário carrega reais em texto e o servidor faz a
 * aritmética, para o cliente nunca arredondar dinheiro.
 */
function reaisToCents(v: string): number | null {
  const raw = v.trim();
  if (!raw) return null;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** "10,5" | "10.5" | "" → percentual 0–100 | null. */
function toPercent(v: string): number | null {
  const raw = v.trim();
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

/** Shape do formulário de lançamento manual no client. */
export interface CashFlowEntryFormInput {
  entryDate: string;
  direction: "ENTRADA" | "SAIDA";
  categoryId: string;
  bankId: string;
  amountReais: string;
  description: string;
  notes: string;
}

/**
 * Campos opcionais viajam como string vazia no formulário; o backend espera
 * ausência (zod `.optional()`), não `""` — daí o `|| undefined`.
 */
function toEntryPayload(input: CashFlowEntryFormInput) {
  return {
    entryDate: input.entryDate,
    direction: input.direction,
    categoryId: input.categoryId || undefined,
    bankId: input.bankId || undefined,
    amountCents: reaisToCents(input.amountReais) ?? 0,
    description: input.description.trim(),
    notes: input.notes.trim() || undefined,
  };
}

function validateEntry(input: CashFlowEntryFormInput): string | null {
  if (!input.entryDate) return "Informe a data do lançamento.";
  if (!input.description.trim()) return "Descreva o lançamento.";
  const cents = reaisToCents(input.amountReais);
  if (cents === null || cents <= 0) return "Informe um valor maior que zero.";
  return null;
}

export async function createCashFlowEntryAction(
  input: CashFlowEntryFormInput,
): Promise<CashFlowActionResult> {
  const invalid = validateEntry(input);
  if (invalid) return { ok: false, error: invalid };

  const res = await postJson("/v1/cash-flow/entries", toEntryPayload(input));
  if (!res.ok) return { ok: false, error: res.error };
  revalidateCashFlow();
  return { ok: true };
}

export async function updateCashFlowEntryAction(
  id: string,
  input: CashFlowEntryFormInput,
): Promise<CashFlowActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const invalid = validateEntry(input);
  if (invalid) return { ok: false, error: invalid };

  // `categoryId`/`bankId` vazios viram null (e não `undefined`): aqui a string
  // vazia significa "desvincular", e omitir o campo manteria o valor antigo.
  const res = await patchJson(`/v1/cash-flow/entries/${id}`, {
    ...toEntryPayload(input),
    categoryId: input.categoryId || null,
    bankId: input.bankId || null,
    notes: input.notes.trim() || null,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateCashFlow();
  return { ok: true };
}

export async function deleteCashFlowEntryAction(
  id: string,
): Promise<CashFlowActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/cash-flow/entries/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateCashFlow();
  return { ok: true };
}

export interface CashFlowCategoryFormInput {
  name: string;
  direction: "ENTRADA" | "SAIDA";
}

export async function createCashFlowCategoryAction(
  input: CashFlowCategoryFormInput,
): Promise<CashFlowActionResult> {
  if (!input.name.trim()) return { ok: false, error: "Informe o nome da categoria." };
  const res = await postJson("/v1/cash-flow/categories", {
    name: input.name.trim(),
    direction: input.direction,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateCashFlow();
  return { ok: true };
}

export async function deleteCashFlowCategoryAction(
  id: string,
): Promise<CashFlowActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/cash-flow/categories/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateCashFlow();
  return { ok: true };
}

/* ------------------------------------ Comissões (MOD-FIN-05) */

const COMMISSION_PATHS = [
  "/financeiro",
  "/financeiro/comissoes",
  "/financeiro/fluxo-de-caixa",
];

function revalidateCommissions(): void {
  for (const path of COMMISSION_PATHS) revalidatePath(path);
}

export interface CommissionActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Shape do formulário de comissão. A tela cobra base + percentual e o backend
 * deriva o valor — mas `amountCents` continua aceito para o acerto avulso em que
 * o número combinado não é o do percentual.
 */
export interface CommissionFormInput {
  party: "IMOBILIARIA" | "CORRETOR";
  propertyId: string;
  brokerId: string;
  description: string;
  /** Valor da venda, em reais digitados. */
  baseReais: string;
  percent: string;
  /** Valor da comissão; vazio deixa o backend derivar de base × percentual. */
  amountReais: string;
  dueDate: string;
}

export async function createCommissionAction(
  input: CommissionFormInput,
): Promise<CommissionActionResult> {
  if (!input.dueDate) return { ok: false, error: "Informe o vencimento." };
  if (input.party === "CORRETOR" && !input.brokerId) {
    return { ok: false, error: "Selecione o corretor." };
  }

  const baseCents = reaisToCents(input.baseReais) ?? 0;
  const percent = toPercent(input.percent) ?? 0;
  const amountCents = reaisToCents(input.amountReais) ?? 0;

  if (amountCents <= 0 && (baseCents <= 0 || percent <= 0)) {
    return { ok: false, error: "Informe o valor da comissão ou a venda e o percentual." };
  }

  const res = await postJson("/v1/commissions", {
    kind: "VENDA",
    party: input.party,
    propertyId: input.propertyId || undefined,
    brokerId: input.brokerId || undefined,
    description: input.description.trim() || undefined,
    baseCents,
    percent,
    // Só manda o valor quando ele foi digitado: vazio deixa o backend derivar de
    // base × percentual, que é o caminho normal da tela.
    amountCents: amountCents > 0 ? amountCents : undefined,
    dueDate: input.dueDate,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateCommissions();
  return { ok: true };
}

/**
 * Quitação. `settledAt` é a data do CAIXA — é ela que decide em que mês a
 * comissão entra no fluxo, e por isso a tela pergunta em vez de assumir hoje
 * (mesmo motivo da baixa do repasse).
 */
export async function settleCommissionAction(
  id: string,
  settledAt?: string,
): Promise<CommissionActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await postJson(
    `/v1/commissions/${id}/settle`,
    settledAt ? { settledAt } : {},
  );
  if (!res.ok) return { ok: false, error: res.error };
  revalidateCommissions();
  return { ok: true };
}

export async function cancelCommissionAction(
  id: string,
): Promise<CommissionActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await postJson(`/v1/commissions/${id}/cancel`, {});
  if (!res.ok) return { ok: false, error: res.error };
  revalidateCommissions();
  return { ok: true };
}

export async function deleteCommissionAction(
  id: string,
): Promise<CommissionActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/commissions/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateCommissions();
  return { ok: true };
}
