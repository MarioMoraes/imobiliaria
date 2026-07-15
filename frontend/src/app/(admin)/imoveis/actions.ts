"use server";

import { revalidatePath } from "next/cache";
import {
  deleteJson,
  fetchPropertyPhotos,
  patchJson,
  postJson,
  type PropertyPhoto,
} from "../../../lib/api";

const PATH = "/imoveis";

export interface OwnerActionResult {
  ok: boolean;
  error?: string;
}

/** Vincula um dono (pessoa LOCADOR) ao imóvel com % de participação. */
export async function addOwnerAction(
  propertyId: string,
  personId: string,
  sharePercent: number,
): Promise<OwnerActionResult> {
  if (!personId) return { ok: false, error: "Selecione um proprietário." };
  const res = await postJson(`/v1/properties/${propertyId}/owners`, {
    personId,
    sharePercent,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/imoveis");
  return { ok: true };
}

/** Desvincula um dono do imóvel. */
export async function removeOwnerAction(
  propertyId: string,
  personId: string,
): Promise<OwnerActionResult> {
  const res = await deleteJson(`/v1/properties/${propertyId}/owners/${personId}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/imoveis");
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────────
 * Cadastro do imóvel (tela legada "Imóveis a Alugar") — create/update/delete.
 * ───────────────────────────────────────────────────────────────── */

/**
 * Shape do formulário no client (espelho da tela legada). Campos de
 * texto/número/select são string; checkboxes são boolean. A conversão para o
 * payload da API (centavos, percentuais, inteiros) acontece aqui.
 */
export interface PropertyFormInput {
  // Identificação
  title: string;
  purpose: string; // finalidade: rent | sale | season
  status: string;
  propertyTypeId: string;
  condominiumId: string;
  contractNumber: string;
  isCommercial: boolean;

  // Endereço
  streetType: string;
  zip: string;
  address: string;
  district: string;
  city: string;
  state: string;
  keysLocation: string;
  hasSign: boolean;
  positionFront: boolean;
  positionBack: boolean;

  // Características
  bedrooms: string;
  builtArea: string;
  landArea: string;
  floorInfo: string;
  ceilingInfo: string;
  electricityMeter: string;
  waterMeter: string;
  dependencies: string;
  allowPets: boolean;
  allowStudents: boolean;

  // Valores / encargos
  priceReais: string;
  condoFeeReais: string;
  iptuReais: string;
  iptuChargedTo: string; // "" | LOCATARIO | LOCADOR
  iptuReimburseOwner: boolean;
  iptuInstallments: string;
  iptuInstallmentReais: string;
  adminFeePercent: string;
  chargeAdminFee: boolean;
  isGuaranteed: boolean;

  // Locação / comissão
  leaseTermMonths: string;
  leaseStart: string; // YYYY-MM-DD
  penaltyInfo: string;
  hasCommission: boolean;
  commissionType: string;
  entryDate: string; // YYYY-MM-DD

  // Captação / publicação / observações
  brokerId: string;
  capturerId: string;
  extraData: string;
  publishWeb: boolean;
  hasPhotos: boolean;
  notes: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** "1.234,56" | "1234.56" | "" → centavos | null (vazio/ inválido → null). */
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

/** "72,50" | "" → número (m²) não-negativo | null. */
function toArea(v: string): number | null {
  const raw = v.trim();
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
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
 * default do schema / ficam nulos). No update, viram `null` para permitir
 * limpar o campo.
 */
function toPayload(input: PropertyFormInput, isEdit: boolean) {
  const opt = <T>(v: T | null): T | null | undefined => (v === null && !isEdit ? undefined : v);

  const purpose = input.purpose || "rent";
  return {
    title: input.title.trim(),
    kind: purpose, // legado: mantém `kind` alinhado à finalidade
    purpose,
    status: input.status || "available",
    propertyTypeId: opt(toText(input.propertyTypeId)),
    condominiumId: opt(toText(input.condominiumId)),
    contractNumber: opt(toText(input.contractNumber)),
    isCommercial: input.isCommercial,

    streetType: opt(toText(input.streetType)),
    zip: opt(toText(input.zip)),
    address: opt(toText(input.address)),
    district: opt(toText(input.district)),
    city: opt(toText(input.city)),
    state: opt(toText(input.state)),
    keysLocation: opt(toText(input.keysLocation)),
    hasSign: input.hasSign,
    positionFront: input.positionFront,
    positionBack: input.positionBack,

    bedrooms: opt(toInt(input.bedrooms)),
    builtArea: opt(toArea(input.builtArea)),
    landArea: opt(toArea(input.landArea)),
    floorInfo: opt(toText(input.floorInfo)),
    ceilingInfo: opt(toText(input.ceilingInfo)),
    electricityMeter: opt(toText(input.electricityMeter)),
    waterMeter: opt(toText(input.waterMeter)),
    dependencies: opt(toText(input.dependencies)),
    allowPets: input.allowPets,
    allowStudents: input.allowStudents,

    priceCents: opt(reaisToCents(input.priceReais)),
    condoFeeCents: opt(reaisToCents(input.condoFeeReais)),
    iptuCents: opt(reaisToCents(input.iptuReais)),
    iptuChargedTo: opt(toText(input.iptuChargedTo)),
    iptuReimburseOwner: input.iptuReimburseOwner,
    iptuInstallments: opt(toInt(input.iptuInstallments)),
    iptuInstallmentCents: opt(reaisToCents(input.iptuInstallmentReais)),
    adminFeePercent: opt(toPercent(input.adminFeePercent)),
    chargeAdminFee: input.chargeAdminFee,
    isGuaranteed: input.isGuaranteed,

    leaseTermMonths: opt(toInt(input.leaseTermMonths)),
    leaseStart: opt(toDate(input.leaseStart)),
    penaltyInfo: opt(toText(input.penaltyInfo)),
    hasCommission: input.hasCommission,
    commissionType: opt(toText(input.commissionType)),
    entryDate: opt(toDate(input.entryDate)),

    brokerId: opt(toText(input.brokerId)),
    capturerId: opt(toText(input.capturerId)),
    extraData: opt(toText(input.extraData)),
    publishWeb: input.publishWeb,
    hasPhotos: input.hasPhotos,
    notes: opt(toText(input.notes)),
  };
}

function validate(input: PropertyFormInput): string | null {
  if (input.title.trim().length < 3) return "Informe o título/descrição do imóvel (mín. 3 caracteres).";
  if (input.state.trim() && input.state.trim().length !== 2) return "UF deve ter 2 letras.";
  return null;
}

export async function createPropertyAction(input: PropertyFormInput): Promise<ActionResult> {
  const err = validate(input);
  if (err) return { ok: false, error: err };
  const res = await postJson("/v1/properties", toPayload(input, false));
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function updatePropertyAction(
  id: string,
  input: PropertyFormInput,
): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const err = validate(input);
  if (err) return { ok: false, error: err };
  const res = await patchJson(`/v1/properties/${id}`, toPayload(input, true));
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deletePropertyAction(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/properties/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────────
 * Fotos do imóvel — data URL base64 (Fase 0). O cliente comprime antes.
 * ───────────────────────────────────────────────────────────────── */

export async function listPhotosAction(
  propertyId: string,
): Promise<{ ok: boolean; photos: PropertyPhoto[]; error?: string }> {
  if (!propertyId) return { ok: false, photos: [], error: "ID inválido." };
  const photos = await fetchPropertyPhotos(propertyId);
  if (photos === null) return { ok: false, photos: [], error: "Não foi possível carregar as fotos." };
  return { ok: true, photos };
}

export async function addPhotoAction(
  propertyId: string,
  dataUrl: string,
  caption?: string,
): Promise<ActionResult> {
  if (!propertyId) return { ok: false, error: "ID inválido." };
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(dataUrl)) {
    return { ok: false, error: "Arquivo não é uma imagem válida." };
  }
  const res = await postJson(`/v1/properties/${propertyId}/photos`, {
    dataUrl,
    caption: caption?.trim() || undefined,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}

export async function removePhotoAction(
  propertyId: string,
  photoId: string,
): Promise<ActionResult> {
  if (!propertyId || !photoId) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/properties/${propertyId}/photos/${photoId}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(PATH);
  return { ok: true };
}
