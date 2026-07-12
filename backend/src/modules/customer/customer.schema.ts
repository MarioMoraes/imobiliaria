import { z } from "zod";

/**
 * Cliente unificado (MOD-CLIENTE): lead → cliente → inquilino/comprador no mesmo
 * registro, distinguidos por `stage`. Ver PRD clientes §4/§5.
 * TODO: cifrar cpf/email/phone em repouso (AES-256-GCM).
 */

export const customerStage = z.enum([
  "LEAD",
  "CLIENTE",
  "INQUILINO",
  "COMPRADOR",
  "INATIVO",
]);
export type CustomerStage = z.infer<typeof customerStage>;

export const customerSource = z.enum([
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

/** Normaliza telefone/cpf: só dígitos (base da deduplicação por contato). */
const digits = (v: string) => v.replace(/\D/g, "");

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

// "Ao menos um contato (email/telefone)" é validado no service para emitir o
// código canônico ERR_CLIENTE_002 (422), não um 400 genérico de parse (PRD AC-02).
export const createCustomerSchema = z.object({
  fullName: z.string().min(2).max(200),
  cpf: z.string().transform(digits).pipe(z.string().length(11)).optional(),
  email: z.string().email().optional(),
  phone: z.string().transform(digits).pipe(z.string().min(8).max(15)).optional(),
  source: customerSource.default("MANUAL"),
  assignedBrokerId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
  searchProfile: searchProfileInput.optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/** Atualização parcial. `stage` aqui só cobre LEAD↔CLIENTE↔INATIVO (RN-05). */
export const updateCustomerSchema = z
  .object({
    fullName: z.string().min(2).max(200).optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().transform(digits).pipe(z.string().min(8).max(15)).nullable().optional(),
    stage: customerStage.optional(),
    assignedBrokerId: z.string().uuid().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

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

export interface Customer {
  id: string;
  tenantId: string;
  fullName: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  stage: CustomerStage;
  source: string;
  assignedBrokerId: string | null;
  notes: string | null;
  searchProfiles: SearchProfile[];
  interactions: Interaction[];
  createdAt: string;
  updatedAt: string;
}
