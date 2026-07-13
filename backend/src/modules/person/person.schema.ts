import { z } from "zod";

/**
 * Pessoa unificada (MOD-PESSOA): LOCADOR / LOCATARIO / FIADOR / COMPRADOR no
 * MESMO registro, distinguidos por `roles[]` (uma pessoa acumula papéis). Funde
 * a ficha PF/PJ (ex-`guarantor`: cônjuge, banco, endereços) e a jornada de
 * lead/cliente (ex-`customer`: stage, perfil de busca, interações append-only).
 * TODO: cifrar cpf_cnpj/rg/email/phone/banco em repouso (AES-256-GCM).
 */

export const personRole = z.enum(["LOCADOR", "LOCATARIO", "FIADOR", "COMPRADOR"]);
export type PersonRole = z.infer<typeof personRole>;

export const personStage = z.enum([
  "LEAD",
  "CLIENTE",
  "INQUILINO",
  "COMPRADOR",
  "INATIVO",
]);
export type PersonStage = z.infer<typeof personStage>;

export const personSource = z.enum([
  "WHATSAPP",
  "INSTAGRAM",
  "SITE",
  "PORTAL",
  "INDICACAO",
  "MANUAL",
]);

export const searchIntent = z.enum(["COMPRA", "LOCACAO"]);

export const interactionChannel = z.enum([
  "WHATSAPP",
  "INSTAGRAM",
  "SITE",
  "PORTAL",
  "EMAIL",
  "TELEFONE",
  "MANUAL",
]);

/** Normaliza para só dígitos (base da deduplicação por documento/telefone). */
const digits = (v: string) => v.replace(/\D/g, "");

export const personAddressSchema = z.object({
  kind: z.enum(["RESIDENCIAL", "COMERCIAL"]).default("RESIDENCIAL"),
  street: z.string().max(200).optional(),
  number: z.string().max(20).optional(),
  district: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  state: z.string().length(2).optional(),
  zip: z.string().max(9).optional(),
  phone: z.string().max(20).optional(),
  mobile: z.string().max(20).optional(),
  fax: z.string().max(20).optional(),
  email: z.string().email().optional(),
});
export type PersonAddressInput = z.infer<typeof personAddressSchema>;

export const searchProfileInput = z.object({
  intent: searchIntent,
  minPriceCents: z.number().int().nonnegative().optional(),
  maxPriceCents: z.number().int().nonnegative().optional(),
  propertyTypes: z.array(z.string().max(60)).default([]),
  districts: z.array(z.string().max(120)).default([]),
  bedroomsMin: z.number().int().nonnegative().optional(),
  parkingMin: z.number().int().nonnegative().optional(),
});
export type SearchProfileInput = z.infer<typeof searchProfileInput>;

// "Ao menos um contato (email/telefone)" e a deduplicação são validados no
// service (para emitir os códigos canônicos ERR_PESSOA_*), não no parse.
export const createPersonSchema = z
  .object({
    roles: z.array(personRole).min(1),
    personType: z.enum(["PF", "PJ"]).default("PF"),
    fullName: z.string().min(2).max(200),
    cpfCnpj: z.string().transform(digits).pipe(z.string().min(11).max(14)).optional(),
    rg: z.string().max(20).optional(),
    rgIssuer: z.string().max(20).optional(),
    gender: z.enum(["M", "F", "OUTRO"]).optional(),
    birthDate: z.string().date().optional(),
    maritalStatus: z
      .enum(["SOLTEIRO", "CASADO", "DIVORCIADO", "VIUVO", "UNIAO_ESTAVEL"])
      .optional(),
    nationality: z.string().max(60).default("BRASILEIRA"),
    occupation: z.string().max(120).optional(),
    email: z.string().email().optional(),
    phone: z.string().transform(digits).pipe(z.string().min(8).max(15)).optional(),
    mobile: z.string().max(20).optional(),
    bank: z.string().max(80).optional(),
    agency: z.string().max(20).optional(),
    account: z.string().max(30).optional(),
    holderName: z.string().max(200).optional(),
    paymentAuthorization: z.string().max(300).optional(),
    spouseName: z.string().max(200).optional(),
    spouseCpf: z.string().max(14).optional(),
    spouseRg: z.string().max(20).optional(),
    spouseOccupation: z.string().max(120).optional(),
    spouseBirthDate: z.string().date().optional(),
    notes: z.string().max(2000).optional(),
    references: z.string().max(2000).optional(),
    source: personSource.default("MANUAL"),
    assignedBrokerId: z.string().uuid().optional(),
    addresses: z.array(personAddressSchema).default([]),
    searchProfile: searchProfileInput.optional(),
  })
  .refine((d) => d.maritalStatus !== "CASADO" || !!d.spouseName, {
    message: "Pessoa casada exige os dados do cônjuge",
    path: ["spouseName"],
  });
export type CreatePersonInput = z.infer<typeof createPersonSchema>;

/** Atualização parcial. `stage` aqui só cobre LEAD↔CLIENTE↔INATIVO (RN-05). */
export const updatePersonSchema = z
  .object({
    roles: z.array(personRole).min(1).optional(),
    personType: z.enum(["PF", "PJ"]).optional(),
    fullName: z.string().min(2).max(200).optional(),
    cpfCnpj: z.string().transform(digits).pipe(z.string().min(11).max(14)).nullable().optional(),
    rg: z.string().max(20).nullable().optional(),
    rgIssuer: z.string().max(20).nullable().optional(),
    gender: z.enum(["M", "F", "OUTRO"]).nullable().optional(),
    birthDate: z.string().date().nullable().optional(),
    maritalStatus: z
      .enum(["SOLTEIRO", "CASADO", "DIVORCIADO", "VIUVO", "UNIAO_ESTAVEL"])
      .nullable()
      .optional(),
    nationality: z.string().max(60).nullable().optional(),
    occupation: z.string().max(120).nullable().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().transform(digits).pipe(z.string().min(8).max(15)).nullable().optional(),
    mobile: z.string().max(20).nullable().optional(),
    bank: z.string().max(80).nullable().optional(),
    agency: z.string().max(20).nullable().optional(),
    account: z.string().max(30).nullable().optional(),
    holderName: z.string().max(200).nullable().optional(),
    paymentAuthorization: z.string().max(300).nullable().optional(),
    spouseName: z.string().max(200).nullable().optional(),
    spouseCpf: z.string().max(14).nullable().optional(),
    spouseRg: z.string().max(20).nullable().optional(),
    spouseOccupation: z.string().max(120).nullable().optional(),
    spouseBirthDate: z.string().date().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    references: z.string().max(2000).nullable().optional(),
    stage: personStage.optional(),
    assignedBrokerId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;

export const addInteractionSchema = z.object({
  channel: interactionChannel,
  actor: z.enum(["HUMANO", "IA"]).default("HUMANO"),
  summary: z.string().min(1).max(2000),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type AddInteractionInput = z.infer<typeof addInteractionSchema>;

export interface SearchProfile {
  id: string;
  intent: string;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  propertyTypes: string[];
  districts: string[];
  bedroomsMin: number | null;
  parkingMin: number | null;
  createdAt: string;
}

export interface Interaction {
  id: string;
  channel: string;
  actor: string;
  summary: string;
  payload: unknown;
  createdAt: string;
}

export interface PersonAddress {
  id: string;
  kind: "RESIDENCIAL" | "COMERCIAL";
  street?: string;
  number?: string;
  district?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  mobile?: string;
  fax?: string;
  email?: string;
}

export interface Person {
  id: string;
  tenantId: string;
  roles: string[];
  personType: string;
  fullName: string;
  cpfCnpj: string | null;
  rg: string | null;
  rgIssuer: string | null;
  gender: string | null;
  birthDate: string | null;
  maritalStatus: string | null;
  nationality: string | null;
  occupation: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  bank: string | null;
  agency: string | null;
  account: string | null;
  holderName: string | null;
  paymentAuthorization: string | null;
  spouseName: string | null;
  spouseCpf: string | null;
  spouseRg: string | null;
  spouseOccupation: string | null;
  spouseBirthDate: string | null;
  notes: string | null;
  references: string | null;
  stage: PersonStage;
  source: string;
  assignedBrokerId: string | null;
  status: string;
  addresses: PersonAddress[];
  searchProfiles: SearchProfile[];
  interactions: Interaction[];
  createdAt: string;
  updatedAt: string;
}
