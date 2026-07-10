import { z } from "zod";

/**
 * Tenant = uma imobiliária contratante (SPEC seção 3.3).
 * Entidade de NÍVEL PLATAFORMA: a tabela `tenants` NÃO tem RLS — ela é o
 * registro que o RLS das demais tabelas referencia. Por isso o repositório
 * usa o pool direto, sem `withTenant`.
 */

export const tenantStatus = z.enum(["active", "suspended", "inactive"]);
export type TenantStatus = z.infer<typeof tenantStatus>;

export const createTenantSchema = z.object({
  name: z.string().min(2).max(200),
  // slug vira subdomínio (<slug>.moveai.com.br): apenas minúsculas, números e hífen.
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Use apenas minúsculas, números e hífen"),
  domain: z.string().max(255).optional(),
  plan: z.string().max(40).default("free"),
});

export const updateTenantSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    domain: z.string().max(255).nullable().optional(),
    plan: z.string().max(40).optional(),
    status: tenantStatus.optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "Informe ao menos um campo para atualizar",
  });

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  plan: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
}
