"use server";

import { revalidatePath } from "next/cache";
import {
  deleteJson,
  fetchContractSignature,
  patchJson,
  postJson,
  type SignatureEnvelope,
} from "../../../lib/api";

/** Revalida a lista de contratos após uma mutação. */
function revalidateContracts() {
  revalidatePath("/contratos");
}

/**
 * Shape do formulário no client (espelho da tela legada "Contratos de Locação").
 * Campos de texto/número/select são string; checkboxes são boolean. A conversão
 * para o payload da API (centavos, percentuais, inteiros) acontece aqui.
 */
export interface ContractFormInput {
  // Cabeçalho / vigência
  propertyId: string;
  templateId: string;
  status: string;
  startsAt: string; // YYYY-MM-DD
  endsAt: string;
  termMonths: string;
  readjustIndex: string;
  readjustPeriodMonths: string;
  lastReadjustAt: string;
  ownerPayDay: string;
  tenantPayDay: string;
  terminatedAt: string;

  // Valores / encargos
  rentalValueReais: string;
  interestPercent: string;
  penaltyPercent: string;
  adminFeePercent: string;
  isAdministration: boolean;
  incomeTaxDeclaration: boolean;
  iptuChargedTo: string; // "" | LOCATARIO | LOCADOR
  commissionType: string;
  hasCommission: boolean;

  // Garantia / seguro
  guaranteeKind: string; // "" | FIADOR | CAUCAO | SEGURO_FIANCA | TITULO_CAP
  hasInsurance: boolean;
  insuranceDescription: string;
  insuranceValueReais: string;

  // Situação (judicial)
  isSettled: boolean;
  hasEvictionOrder: boolean;
  hasJudicialExecution: boolean;
  processNumber: string;
  court: string;

  // Cláusulas
  specialClauses: string;
  guarantorPropertyInfo: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** "1.234,56" | "1234.56" | "" → centavos | null. */
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

/** "3" | "" → inteiro não-negativo | null. */
function toInt(v: string): number | null {
  const raw = v.trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Texto trim; "" → null. */
function toText(v: string): string | null {
  const t = v.trim();
  return t || null;
}

/** ISO date válido ou null. */
function toDate(v: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
}

/**
 * Monta o payload da API. No create, campos vazios viram `undefined` (usam o
 * default do schema / ficam nulos). No update, viram `null` para permitir limpar.
 */
function toPayload(input: ContractFormInput, isEdit: boolean) {
  const opt = <T>(v: T | null): T | null | undefined => (v === null && !isEdit ? undefined : v);

  return {
    propertyId: opt(toText(input.propertyId)),
    templateId: opt(toText(input.templateId)),
    status: input.status || "RASCUNHO",

    startsAt: opt(toDate(input.startsAt)),
    endsAt: opt(toDate(input.endsAt)),
    termMonths: opt(toInt(input.termMonths)),
    readjustIndex: input.readjustIndex || "IPCA",
    readjustPeriodMonths: opt(toInt(input.readjustPeriodMonths)),
    lastReadjustAt: opt(toDate(input.lastReadjustAt)),
    ownerPayDay: opt(toInt(input.ownerPayDay)),
    tenantPayDay: opt(toInt(input.tenantPayDay)),
    terminatedAt: opt(toDate(input.terminatedAt)),

    rentalValueCents: opt(reaisToCents(input.rentalValueReais)),
    interestPercent: opt(toPercent(input.interestPercent)),
    penaltyPercent: opt(toPercent(input.penaltyPercent)),
    adminFeePercent: opt(toPercent(input.adminFeePercent)),
    isAdministration: input.isAdministration,
    incomeTaxDeclaration: input.incomeTaxDeclaration,
    iptuChargedTo: opt(toText(input.iptuChargedTo)),
    commissionType: opt(toText(input.commissionType)),
    hasCommission: input.hasCommission,

    guaranteeKind: opt(toText(input.guaranteeKind)),
    hasInsurance: input.hasInsurance,
    insuranceDescription: opt(toText(input.insuranceDescription)),
    insuranceValueCents: opt(reaisToCents(input.insuranceValueReais)),

    isSettled: input.isSettled,
    hasEvictionOrder: input.hasEvictionOrder,
    hasJudicialExecution: input.hasJudicialExecution,
    processNumber: opt(toText(input.processNumber)),
    court: opt(toText(input.court)),

    specialClauses: opt(toText(input.specialClauses)),
    guarantorPropertyInfo: opt(toText(input.guarantorPropertyInfo)),
  };
}

/** Dias de pagamento devem ficar entre 1 e 31. */
function validate(input: ContractFormInput): string | null {
  for (const [label, v] of [["Dia Prop.", input.ownerPayDay], ["Dia Inq.", input.tenantPayDay]] as const) {
    const n = toInt(v);
    if (n !== null && (n < 1 || n > 31)) return `${label} deve estar entre 1 e 31.`;
  }
  return null;
}

export async function createContractAction(input: ContractFormInput): Promise<ActionResult> {
  const err = validate(input);
  if (err) return { ok: false, error: err };
  const res = await postJson("/v1/contracts", toPayload(input, false));
  if (!res.ok) return { ok: false, error: res.error };
  revalidateContracts();
  return { ok: true };
}

export async function updateContractAction(
  id: string,
  input: ContractFormInput,
): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  const res = await patchJson(`/v1/contracts/${id}`, toPayload(input, true));
  if (!res.ok) return { ok: false, error: res.error };
  revalidateContracts();
  return { ok: true };
}

export async function deleteContractAction(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/contracts/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateContracts();
  return { ok: true };
}

/* ─────────────────────────────────────────── Partes do contrato */

export async function addPartyAction(
  contractId: string,
  role: string,
  personId: string,
): Promise<ActionResult> {
  if (!personId) return { ok: false, error: "Selecione uma pessoa." };
  const res = await postJson(`/v1/contracts/${contractId}/parties`, { role, personId });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateContracts();
  return { ok: true };
}

export async function removePartyAction(
  contractId: string,
  partyId: string,
): Promise<ActionResult> {
  const res = await deleteJson(`/v1/contracts/${contractId}/parties/${partyId}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateContracts();
  return { ok: true };
}

/* ─────────────────────────────────── Geração do documento (PDF) */

export interface GenerateResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/** Gera o "Contrato de Locação" (PDF) e devolve a URL presignada para abrir. */
export async function generateContractPdfAction(contractId: string): Promise<GenerateResult> {
  if (!contractId) return { ok: false, error: "ID inválido." };
  const res = await postJson(`/v1/contracts/${contractId}/generate`, {});
  if (!res.ok) return { ok: false, error: res.error };
  const url = (res.data as { url?: string })?.url;
  if (!url) return { ok: false, error: "PDF gerado, mas sem URL de acesso." };
  revalidateContracts();
  return { ok: true, url };
}

/* ────────────────────────────────── Assinatura eletrônica (ZapSign) */

export interface SignatureResult {
  ok: boolean;
  envelope?: SignatureEnvelope;
  error?: string;
}

/**
 * Vincula o modelo usado para gerar o documento deste contrato. Grava na hora
 * (não espera o "Salvar" do formulário): quem escolhe o modelo na aba de
 * assinatura costuma enviar em seguida, e um modelo só selecionado na tela
 * geraria o PDF errado.
 */
export async function linkTemplateAction(
  contractId: string,
  templateId: string,
): Promise<ActionResult> {
  if (!contractId) return { ok: false, error: "ID inválido." };
  const res = await patchJson(`/v1/contracts/${contractId}`, {
    templateId: templateId || null, // "" → volta ao padrão do tenant
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidateContracts();
  return { ok: true };
}

/** Estado atual da assinatura (null se o contrato nunca foi enviado). */
export async function loadSignatureAction(contractId: string): Promise<SignatureResult> {
  if (!contractId) return { ok: false, error: "ID inválido." };
  const envelope = await fetchContractSignature(contractId);
  return { ok: true, envelope: envelope ?? undefined };
}

/**
 * Envia o contrato para assinatura. Gera a versão do PDF, cria o documento no
 * provedor e devolve os links de assinatura de cada parte.
 */
export async function sendToSignAction(contractId: string): Promise<SignatureResult> {
  if (!contractId) return { ok: false, error: "ID inválido." };
  const res = await postJson(`/v1/contracts/${contractId}/send-to-sign`, {});
  if (!res.ok) return { ok: false, error: res.error };
  revalidateContracts();
  return { ok: true, envelope: res.data as SignatureEnvelope };
}

/**
 * Consulta o provedor e aplica o estado atual. É o caminho usado em
 * desenvolvimento, onde o webhook não alcança a máquina local.
 */
export async function syncSignatureAction(contractId: string): Promise<SignatureResult> {
  if (!contractId) return { ok: false, error: "ID inválido." };
  const res = await postJson(`/v1/contracts/${contractId}/sync-signature`, {});
  if (!res.ok) return { ok: false, error: res.error };
  revalidateContracts();
  return { ok: true, envelope: res.data as SignatureEnvelope };
}
