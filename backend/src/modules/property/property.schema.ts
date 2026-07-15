import { z } from "zod";

export const propertyKind = z.enum([
  "sale",
  "rent",
  "season",
  "commercial",
  "rural",
  "land",
]);

export const propertyStatus = z.enum([
  "available",
  "reserved",
  "rented",
  "sold",
  "inactive",
]);

/** Finalidade do negócio — distinta do TIPO do imóvel (ver property_types). */
export const propertyPurpose = z.enum(["sale", "rent", "season"]);

/** Quem arca com o IPTU (tela legada "Descontar IPTU de"). */
export const iptuChargedTo = z.enum(["LOCATARIO", "LOCADOR"]);

/** Percentual 0–100 (Tx Adm %). */
const percent = z.number().min(0).max(100);
/** Valor monetário em centavos (não-negativo). */
const cents = z.number().int().nonnegative();
/** Área em m² (não-negativa, até 2 casas). */
const area = z.number().nonnegative();
/** Texto curto opcional. */
const shortText = z.string().max(200);
/** Data ISO (YYYY-MM-DD) opcional. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (YYYY-MM-DD)");

/**
 * Núcleo de campos editáveis do cadastro "Imóveis a Alugar". Usado tanto no
 * create (com defaults) quanto, tornado parcial/nullable, no update. `code` é
 * atribuído pelo backend (sequencial por tenant) e é somente leitura.
 */
const propertyFields = {
  title: z.string().min(3).max(200),
  kind: propertyKind,
  purpose: propertyPurpose,
  propertyTypeId: z.string().uuid(),
  isDevelopment: z.boolean(),
  status: propertyStatus,
  priceCents: cents,

  // Identificação
  contractNumber: shortText,
  condominiumId: z.string().uuid(),
  isCommercial: z.boolean(),

  // Endereço
  streetType: shortText,
  address: z.string().max(200),
  district: z.string().max(120),
  city: z.string().max(120),
  state: z.string().length(2),
  zip: z.string().max(9),
  keysLocation: shortText,
  hasSign: z.boolean(),
  positionFront: z.boolean(),
  positionBack: z.boolean(),

  // Características
  bedrooms: z.number().int().nonnegative(),
  builtArea: area,
  landArea: area,
  floorInfo: shortText,
  ceilingInfo: shortText,
  electricityMeter: shortText,
  waterMeter: shortText,
  dependencies: z.string().max(500),
  allowPets: z.boolean(),
  allowStudents: z.boolean(),

  // Valores / encargos
  condoFeeCents: cents,
  iptuCents: cents,
  iptuChargedTo: iptuChargedTo,
  iptuReimburseOwner: z.boolean(),
  iptuInstallments: z.number().int().nonnegative(),
  iptuInstallmentCents: cents,
  adminFeePercent: percent,
  chargeAdminFee: z.boolean(),
  isGuaranteed: z.boolean(),

  // Locação / comissão
  leaseTermMonths: z.number().int().nonnegative(),
  leaseStart: isoDate,
  penaltyInfo: shortText,
  hasCommission: z.boolean(),
  commissionType: shortText,
  entryDate: isoDate,

  // Captação / publicação / observações
  brokerId: z.string().uuid(),
  capturerId: z.string().uuid(),
  extraData: z.string().max(500),
  publishWeb: z.boolean(),
  hasPhotos: z.boolean(),
  notes: z.string().max(2000),
} as const;

/** Payload de criação de imóvel. */
export const createPropertySchema = z.object({
  title: propertyFields.title,
  kind: propertyKind.default("rent"),
  purpose: propertyPurpose.default("rent"),
  propertyTypeId: propertyFields.propertyTypeId.optional(),
  isDevelopment: z.boolean().default(false),
  status: propertyStatus.default("available"),
  priceCents: cents.optional(),

  contractNumber: propertyFields.contractNumber.optional(),
  condominiumId: propertyFields.condominiumId.optional(),
  isCommercial: z.boolean().default(false),

  streetType: propertyFields.streetType.optional(),
  address: propertyFields.address.optional(),
  district: propertyFields.district.optional(),
  city: propertyFields.city.optional(),
  state: propertyFields.state.optional(),
  zip: propertyFields.zip.optional(),
  keysLocation: propertyFields.keysLocation.optional(),
  hasSign: z.boolean().default(false),
  positionFront: z.boolean().default(false),
  positionBack: z.boolean().default(false),

  bedrooms: propertyFields.bedrooms.optional(),
  builtArea: area.optional(),
  landArea: area.optional(),
  floorInfo: propertyFields.floorInfo.optional(),
  ceilingInfo: propertyFields.ceilingInfo.optional(),
  electricityMeter: propertyFields.electricityMeter.optional(),
  waterMeter: propertyFields.waterMeter.optional(),
  dependencies: propertyFields.dependencies.optional(),
  allowPets: z.boolean().default(false),
  allowStudents: z.boolean().default(false),

  condoFeeCents: cents.optional(),
  iptuCents: cents.optional(),
  iptuChargedTo: iptuChargedTo.optional(),
  iptuReimburseOwner: z.boolean().default(false),
  iptuInstallments: propertyFields.iptuInstallments.optional(),
  iptuInstallmentCents: cents.optional(),
  adminFeePercent: percent.optional(),
  chargeAdminFee: z.boolean().default(false),
  isGuaranteed: z.boolean().default(false),

  leaseTermMonths: propertyFields.leaseTermMonths.optional(),
  leaseStart: isoDate.optional(),
  penaltyInfo: propertyFields.penaltyInfo.optional(),
  hasCommission: z.boolean().default(false),
  commissionType: propertyFields.commissionType.optional(),
  entryDate: isoDate.optional(),

  brokerId: propertyFields.brokerId.optional(),
  capturerId: propertyFields.capturerId.optional(),
  extraData: propertyFields.extraData.optional(),
  publishWeb: z.boolean().default(false),
  hasPhotos: z.boolean().default(false),
  notes: propertyFields.notes.optional(),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

/**
 * Atualização parcial. Todos os campos opcionais; os de texto/FK aceitam `null`
 * para limpar. Ao menos um campo deve estar presente.
 */
export const updatePropertySchema = z
  .object({
    title: propertyFields.title.optional(),
    kind: propertyKind.optional(),
    purpose: propertyPurpose.optional(),
    propertyTypeId: propertyFields.propertyTypeId.nullable().optional(),
    isDevelopment: z.boolean().optional(),
    status: propertyStatus.optional(),
    priceCents: cents.nullable().optional(),

    contractNumber: propertyFields.contractNumber.nullable().optional(),
    condominiumId: propertyFields.condominiumId.nullable().optional(),
    isCommercial: z.boolean().optional(),

    streetType: propertyFields.streetType.nullable().optional(),
    address: propertyFields.address.nullable().optional(),
    district: propertyFields.district.nullable().optional(),
    city: propertyFields.city.nullable().optional(),
    state: propertyFields.state.nullable().optional(),
    zip: propertyFields.zip.nullable().optional(),
    keysLocation: propertyFields.keysLocation.nullable().optional(),
    hasSign: z.boolean().optional(),
    positionFront: z.boolean().optional(),
    positionBack: z.boolean().optional(),

    bedrooms: propertyFields.bedrooms.nullable().optional(),
    builtArea: area.nullable().optional(),
    landArea: area.nullable().optional(),
    floorInfo: propertyFields.floorInfo.nullable().optional(),
    ceilingInfo: propertyFields.ceilingInfo.nullable().optional(),
    electricityMeter: propertyFields.electricityMeter.nullable().optional(),
    waterMeter: propertyFields.waterMeter.nullable().optional(),
    dependencies: propertyFields.dependencies.nullable().optional(),
    allowPets: z.boolean().optional(),
    allowStudents: z.boolean().optional(),

    condoFeeCents: cents.nullable().optional(),
    iptuCents: cents.nullable().optional(),
    iptuChargedTo: iptuChargedTo.nullable().optional(),
    iptuReimburseOwner: z.boolean().optional(),
    iptuInstallments: propertyFields.iptuInstallments.nullable().optional(),
    iptuInstallmentCents: cents.nullable().optional(),
    adminFeePercent: percent.nullable().optional(),
    chargeAdminFee: z.boolean().optional(),
    isGuaranteed: z.boolean().optional(),

    leaseTermMonths: propertyFields.leaseTermMonths.nullable().optional(),
    leaseStart: isoDate.nullable().optional(),
    penaltyInfo: propertyFields.penaltyInfo.nullable().optional(),
    hasCommission: z.boolean().optional(),
    commissionType: propertyFields.commissionType.nullable().optional(),
    entryDate: isoDate.nullable().optional(),

    brokerId: propertyFields.brokerId.nullable().optional(),
    capturerId: propertyFields.capturerId.nullable().optional(),
    extraData: propertyFields.extraData.nullable().optional(),
    publishWeb: z.boolean().optional(),
    hasPhotos: z.boolean().optional(),
    notes: propertyFields.notes.nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;

/** Vínculo imóvel↔dono (proprietário = pessoa com papel LOCADOR). */
export const addOwnerSchema = z.object({
  personId: z.string().uuid(),
  sharePercent: z.number().min(0).max(100).default(100),
});
export type AddOwnerInput = z.infer<typeof addOwnerSchema>;

export interface PropertyOwner {
  id: string;
  personId: string;
  personName: string;
  sharePercent: number;
}

/**
 * Foto do imóvel (Fase 0): imagem embutida como data URL base64. Limite ~6 MB
 * de string (o cliente já comprime; o payload real fica bem menor).
 */
export const addPhotoSchema = z.object({
  dataUrl: z
    .string()
    .max(6_000_000)
    .regex(/^data:image\/(png|jpe?g|webp|gif);base64,/, "Imagem inválida (esperado data URL)"),
  caption: z.string().max(200).optional(),
});
export type AddPhotoInput = z.infer<typeof addPhotoSchema>;

/** Registro da foto como está no banco (chave no storage, sem URL). */
export interface StoredPhoto {
  id: string;
  propertyId: string;
  storageKey: string;
  contentType: string | null;
  sizeBytes: number | null;
  caption: string | null;
  position: number;
  createdAt: string;
}

/** Foto exposta ao cliente: `url` é presignada (temporária) para o object storage. */
export interface PropertyPhoto {
  id: string;
  propertyId: string;
  url: string;
  caption: string | null;
  position: number;
  createdAt: string;
}

export interface Property {
  id: string;
  tenantId: string;
  code: number | null;
  title: string;
  kind: string;
  purpose: string;
  propertyTypeId: string | null;
  isDevelopment: boolean;
  status: string;
  priceCents: number | null;

  contractNumber: string | null;
  condominiumId: string | null;
  isCommercial: boolean;

  streetType: string | null;
  address: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  keysLocation: string | null;
  hasSign: boolean;
  positionFront: boolean;
  positionBack: boolean;

  bedrooms: number | null;
  builtArea: number | null;
  landArea: number | null;
  floorInfo: string | null;
  ceilingInfo: string | null;
  electricityMeter: string | null;
  waterMeter: string | null;
  dependencies: string | null;
  allowPets: boolean;
  allowStudents: boolean;

  condoFeeCents: number | null;
  iptuCents: number | null;
  iptuChargedTo: string | null;
  iptuReimburseOwner: boolean;
  iptuInstallments: number | null;
  iptuInstallmentCents: number | null;
  adminFeePercent: number | null;
  chargeAdminFee: boolean;
  isGuaranteed: boolean;

  leaseTermMonths: number | null;
  leaseStart: string | null;
  penaltyInfo: string | null;
  hasCommission: boolean;
  commissionType: string | null;
  entryDate: string | null;

  brokerId: string | null;
  capturerId: string | null;
  extraData: string | null;
  publishWeb: boolean;
  hasPhotos: boolean;
  notes: string | null;

  owners: PropertyOwner[];
  createdAt: string;
  updatedAt: string;
}
