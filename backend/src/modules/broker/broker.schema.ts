import { z } from "zod";

/**
 * Corretor (MOD-CORRETOR) — cadastro simples de corretores parceiros (tela
 * legada "Cadastro de Corretores"): identificação (nome + CPF/RG), contato
 * (telefone/celular), endereço e o percentual de comissão. `code` é sequencial
 * por tenant, atribuído pelo backend na inclusão (não vem do input).
 */

/** Percentual 0–100 com até 2 casas (Comissão %). */
const percent = z.number().min(0).max(100);

export const createBrokerSchema = z.object({
  name: z.string().min(2).max(120),
  address: z.string().max(200).optional(),
  district: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(2).optional(),
  zip: z.string().max(9).optional(),
  phone: z.string().max(20).optional(),
  mobile: z.string().max(20).optional(),
  cpf: z.string().max(20).optional(),
  rg: z.string().max(30).optional(),
  commissionPercent: percent.default(0),
});
export type CreateBrokerInput = z.infer<typeof createBrokerSchema>;

/** Atualização parcial. `null` limpa campos opcionais. */
export const updateBrokerSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    address: z.string().max(200).nullable().optional(),
    district: z.string().max(120).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    state: z.string().max(2).nullable().optional(),
    zip: z.string().max(9).nullable().optional(),
    phone: z.string().max(20).nullable().optional(),
    mobile: z.string().max(20).nullable().optional(),
    cpf: z.string().max(20).nullable().optional(),
    rg: z.string().max(30).nullable().optional(),
    commissionPercent: percent.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdateBrokerInput = z.infer<typeof updateBrokerSchema>;

export interface Broker {
  id: string;
  tenantId: string;
  code: number;
  name: string;
  address: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  mobile: string | null;
  cpf: string | null;
  rg: string | null;
  commissionPercent: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
