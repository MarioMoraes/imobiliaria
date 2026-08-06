"use server";

import { revalidatePath } from "next/cache";
import {
  deleteJson,
  fetchBrokers,
  fetchPaymentMethods,
  fetchPropertyInspection,
  fetchPropertyPhotos,
  fetchSalesByProperty,
  patchJson,
  postJson,
  sendJson,
  type Broker,
  type InspectionCondition,
  type PaymentMethod,
  type PropertyInspectionView,
  type PropertyPhoto,
  type Sale,
} from "../../../lib/api";

/** Revalida o hub e as duas listas (alugar/vender) após uma mutação. */
function revalidateLists() {
  revalidatePath("/imoveis");
  revalidatePath("/imoveis/alugar");
  revalidatePath("/imoveis/vender");
}

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
  revalidateLists();
  return { ok: true };
}

/** Desvincula um dono do imóvel. */
export async function removeOwnerAction(
  propertyId: string,
  personId: string,
): Promise<OwnerActionResult> {
  const res = await deleteJson(`/v1/properties/${propertyId}/owners/${personId}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateLists();
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
  /** Situação — LEITURA (vem do backend); o que o operador muda é `reserved`. */
  status: string;
  reserved: boolean;
  propertyTypeId: string;
  condominiumId: string;
  /** Contrato — LEITURA: gravado pelo contrato ao entrar em vigência. */
  contractNumber: string;
  isCommercial: boolean;

  // Endereço
  zip: string;
  address: string;
  number: string;
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
  penaltyInfo: string;
  hasCommission: boolean;
  commissionType: string;
  /** Entrada — LEITURA: gravada pelo contrato ao entrar em vigência. */
  entryDate: string; // YYYY-MM-DD

  // Captação / publicação / observações
  brokerId: string;
  capturerId: string;
  extraData: string;
  publishWeb: boolean;
  hasPhotos: boolean;
  notes: string;

  // Venda — autorização de venda / documentação
  isAuthorized: boolean;
  isExclusive: boolean;
  authTerm: string;
  authDays: string;
  authExpiry: string; // YYYY-MM-DD
  isRecorded: boolean;
  hasDeed: boolean;
  isRegistered: boolean;
  isSold: boolean;
  registryOffice: string;
  registrationNumber: string;

  // Venda — medidas do terreno
  topography: string;
  lotNumber: string;
  blockNumber: string;
  frontMeasure: string;
  backMeasure: string;
  leftMeasure: string;
  rightMeasure: string;
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
    // A Situação NÃO vai no payload: é ciclo de vida, movida pelo contrato ao
    // entrar em vigência. Reenviá-la faria um cadastro aberto ANTES da
    // assinatura devolver o imóvel alugado à vitrine ao salvar. O operador mexe
    // nela pelo "Reservado", que o backend traduz (disponível ⇄ reservado).
    reserved: input.reserved,
    propertyTypeId: opt(toText(input.propertyTypeId)),
    condominiumId: opt(toText(input.condominiumId)),
    // `contractNumber` e `entryDate` seguem a Situação: são ciclo de vida,
    // gravados pelo contrato ao entrar em vigência. Fora do payload — reenviá-los
    // de um cadastro aberto antes da assinatura apagaria o que o contrato gravou.
    isCommercial: input.isCommercial,

    zip: opt(toText(input.zip)),
    address: opt(toText(input.address)),
    number: opt(toText(input.number)),
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
    penaltyInfo: opt(toText(input.penaltyInfo)),
    hasCommission: input.hasCommission,
    commissionType: opt(toText(input.commissionType)),

    brokerId: opt(toText(input.brokerId)),
    capturerId: opt(toText(input.capturerId)),
    extraData: opt(toText(input.extraData)),
    publishWeb: input.publishWeb,
    hasPhotos: input.hasPhotos,
    notes: opt(toText(input.notes)),

    isAuthorized: input.isAuthorized,
    isExclusive: input.isExclusive,
    authTerm: opt(toText(input.authTerm)),
    authDays: opt(toInt(input.authDays)),
    authExpiry: opt(toDate(input.authExpiry)),
    isRecorded: input.isRecorded,
    hasDeed: input.hasDeed,
    isRegistered: input.isRegistered,
    isSold: input.isSold,
    registryOffice: opt(toText(input.registryOffice)),
    registrationNumber: opt(toText(input.registrationNumber)),

    topography: opt(toText(input.topography)),
    lotNumber: opt(toText(input.lotNumber)),
    blockNumber: opt(toText(input.blockNumber)),
    frontMeasure: opt(toText(input.frontMeasure)),
    backMeasure: opt(toText(input.backMeasure)),
    leftMeasure: opt(toText(input.leftMeasure)),
    rightMeasure: opt(toText(input.rightMeasure)),
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
  revalidateLists();
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
  revalidateLists();
  return { ok: true };
}

export async function deletePropertyAction(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/properties/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateLists();
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
  revalidateLists();
  return { ok: true };
}

export async function removePhotoAction(
  propertyId: string,
  photoId: string,
): Promise<ActionResult> {
  if (!propertyId || !photoId) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/properties/${propertyId}/photos/${photoId}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateLists();
  return { ok: true };
}

/* ------------------------------------------------------------- Vistoria */

/**
 * Carrega a vistoria do imóvel. A primeira chamada cria a vistoria e as linhas
 * a partir do catálogo de Itens de Vistoria (é o backend que faz isso), então a
 * tela nunca abre vazia por falta de um passo de "gerar lista".
 */
export async function loadInspectionAction(
  propertyId: string,
): Promise<{ ok: boolean; view?: PropertyInspectionView; error?: string }> {
  if (!propertyId) return { ok: false, error: "ID inválido." };
  const view = await fetchPropertyInspection(propertyId);
  if (view === null) {
    return { ok: false, error: "Não foi possível carregar a vistoria." };
  }
  return { ok: true, view };
}

/** Grava o preenchimento inteiro da vistoria (o "Confirmar" da tela). */
export async function saveInspectionAction(
  propertyId: string,
  entries: {
    id: string;
    quantity: number;
    condition: InspectionCondition | null;
    notes: string | null;
  }[],
  notes: string | null,
): Promise<ActionResult> {
  if (!propertyId) return { ok: false, error: "ID inválido." };
  const res = await sendJson("PUT", `/v1/properties/${propertyId}/inspection`, {
    entries,
    notes,
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

/* ---------------------------------------------------- Venda do imóvel */

/**
 * Shape do formulário de venda no client: tudo string, como no cadastro do
 * imóvel. A conversão para o payload da API (centavos, percentual, data) é
 * feita aqui, no servidor.
 */
export interface SaleFormInput {
  soldAt: string;
  buyerName: string;
  buyerNationality: string;
  buyerMaritalStatus: string;
  buyerOccupation: string;
  buyerAddress: string;
  buyerDistrict: string;
  buyerCity: string;
  buyerState: string;
  buyerZip: string;
  buyerCpf: string;
  buyerRg: string;
  spouseName: string;
  spouseNationality: string;
  spouseOccupation: string;
  spouseCpf: string;
  spouseRg: string;
  marriageRegime: string;
  paymentMethodId: string;
  paymentNotes: string;
  /** Comissão em % sobre o valor da venda ("6" ou "6,00"). */
  commissionPercent: string;
  /** Valor da venda em reais, como digitado ("500.000,00"). */
  valueReais: string;
  brokerId: string;
}

/** "" → null: campo em branco não vira string vazia no banco. */
const orNull = (v: string): string | null => (v.trim() ? v.trim() : null);

/**
 * Valor e comissão são obrigatórios no payload da venda (o backend os usa para
 * apurar a comissão), então o `null` dos conversores do cadastro do imóvel vira
 * zero aqui: uma venda pode ser registrada antes de o valor estar fechado.
 */
function toSalePayload(form: SaleFormInput) {
  return {
    soldAt: orNull(form.soldAt),
    buyerName: form.buyerName.trim(),
    buyerNationality: orNull(form.buyerNationality),
    buyerMaritalStatus: orNull(form.buyerMaritalStatus),
    buyerOccupation: orNull(form.buyerOccupation),
    buyerAddress: orNull(form.buyerAddress),
    buyerDistrict: orNull(form.buyerDistrict),
    buyerCity: orNull(form.buyerCity),
    buyerState: orNull(form.buyerState),
    buyerZip: orNull(form.buyerZip),
    buyerCpf: orNull(form.buyerCpf),
    buyerRg: orNull(form.buyerRg),
    spouseName: orNull(form.spouseName),
    spouseNationality: orNull(form.spouseNationality),
    spouseOccupation: orNull(form.spouseOccupation),
    spouseCpf: orNull(form.spouseCpf),
    spouseRg: orNull(form.spouseRg),
    marriageRegime: orNull(form.marriageRegime),
    paymentMethodId: orNull(form.paymentMethodId),
    paymentNotes: orNull(form.paymentNotes),
    commissionPercent: toPercent(form.commissionPercent) ?? 0,
    valueCents: reaisToCents(form.valueReais) ?? 0,
    brokerId: orNull(form.brokerId),
  };
}

/**
 * Carrega o cadastro da venda do imóvel e as tabelas que a tela precisa
 * (formas de pagamento e corretores) numa chamada só — abrir o modal não deve
 * custar três idas ao servidor.
 *
 * `sale: null` com `ok: true` é o imóvel ainda não vendido; `ok: false` é falha
 * de verdade. Distinguir os dois é o que evita a tela em branco sem explicação.
 */
export async function loadSaleAction(propertyId: string): Promise<{
  ok: boolean;
  sale?: Sale | null;
  paymentMethods?: PaymentMethod[];
  brokers?: Broker[];
  error?: string;
}> {
  if (!propertyId) return { ok: false, error: "ID inválido." };
  const [sales, paymentMethods, brokers] = await Promise.all([
    fetchSalesByProperty(propertyId),
    fetchPaymentMethods(),
    fetchBrokers(),
  ]);
  if (sales === null) {
    return { ok: false, error: "Não foi possível carregar a venda deste imóvel." };
  }
  return {
    ok: true,
    sale: sales[0] ?? null,
    paymentMethods: paymentMethods ?? [],
    brokers: brokers ?? [],
  };
}

/**
 * Salva a venda: cria na primeira vez, atualiza depois. É o POST que dispara o
 * fechamento no backend (imóvel vira Vendido, comissões nascem).
 */
export async function saveSaleAction(
  propertyId: string,
  saleId: string | null,
  form: SaleFormInput,
): Promise<ActionResult> {
  if (!propertyId) return { ok: false, error: "ID inválido." };
  if (!form.buyerName.trim()) return { ok: false, error: "Informe o nome do comprador." };

  const payload = toSalePayload(form);
  const res = saleId
    ? await patchJson(`/v1/sales/${saleId}`, payload)
    : await postJson("/v1/sales", { propertyId, ...payload });

  if (!res.ok) return { ok: false, error: res.error };
  revalidateLists();
  return { ok: true };
}

/** Desfaz a venda: o imóvel volta a Disponível (as comissões permanecem). */
export async function deleteSaleAction(saleId: string): Promise<ActionResult> {
  if (!saleId) return { ok: false, error: "ID inválido." };
  const res = await deleteJson(`/v1/sales/${saleId}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidateLists();
  return { ok: true };
}
