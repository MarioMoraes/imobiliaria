import { z } from "zod";

/**
 * Fiador (MOD-FIADOR) — ficha PF/PJ + cônjuge + endereços.
 * Espelha a tela legada "Cadastro de Fiadores".
 * TODO: criptografar cpf_cnpj/rg/dados bancários em repouso (AES-256-GCM).
 */

export const guarantorAddressSchema = z.object({
  kind: z.enum(["RESIDENCIAL", "COMERCIAL"]).default("RESIDENCIAL"),
  street: z.string().max(200).optional(),
  number: z.string().max(20).optional(),
  district: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  state: z.string().length(2).optional(),
  zip: z.string().max(9).optional(),
});

export const createGuarantorSchema = z
  .object({
    personType: z.enum(["PF", "PJ"]).default("PF"),
    cpfCnpj: z.string().min(11).max(18),
    fullName: z.string().min(2).max(200),
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
    phone: z.string().max(20).optional(),
    mobile: z.string().max(20).optional(),
    bank: z.string().max(80).optional(),
    agency: z.string().max(20).optional(),
    account: z.string().max(30).optional(),
    holderName: z.string().max(200).optional(),
    spouseName: z.string().max(200).optional(),
    spouseCpf: z.string().max(14).optional(),
    notes: z.string().max(2000).optional(),
    references: z.string().max(2000).optional(),
    addresses: z.array(guarantorAddressSchema).default([]),
  })
  .refine((d) => d.maritalStatus !== "CASADO" || !!d.spouseName, {
    message: "Fiança de pessoa casada exige os dados do cônjuge",
    path: ["spouseName"],
  });

export type CreateGuarantorInput = z.infer<typeof createGuarantorSchema>;
export type GuarantorAddress = z.infer<typeof guarantorAddressSchema>;

export interface Guarantor {
  id: string;
  tenantId: string;
  personType: string;
  cpfCnpj: string;
  fullName: string;
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
  spouseName: string | null;
  spouseCpf: string | null;
  notes: string | null;
  references: string | null;
  status: string;
  addresses: (GuarantorAddress & { id: string })[];
  createdAt: string;
  updatedAt: string;
}
