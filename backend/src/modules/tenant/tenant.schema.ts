import { z } from "zod";

/**
 * Tenant = uma imobiliária contratante (SPEC seção 3.3).
 * Entidade de NÍVEL PLATAFORMA: a tabela `tenants` NÃO tem RLS — ela é o
 * registro que o RLS das demais tabelas referencia. Por isso o repositório
 * usa o pool direto, sem `withTenant`.
 */

// Ciclo de vida do tenant (PRD MOD-AUTH seção 6). `trial` é o estado inicial do
// onboarding; `trial` e `active` podem usar o produto, os demais são bloqueados.
export const tenantStatus = z.enum([
  "trial",
  "active",
  "suspended",
  "inactive",
  "canceled",
]);
export type TenantStatus = z.infer<typeof tenantStatus>;

export const createTenantSchema = z.object({
  name: z.string().min(2).max(200),
  // slug vira subdomínio (<slug>.officesai.com.br): apenas minúsculas, números e hífen.
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Use apenas minúsculas, números e hífen"),
  domain: z.string().max(255).optional(),
  // logo/ícone da imobiliária. Fase 0: aceita data URL (base64) guardado na
  // coluna logo_url. Limite generoso p/ um ícone pequeno (~700 KB de imagem).
  logoUrl: z.string().max(1_000_000).optional(),
  plan: z.string().max(40).default("free"),
});

export const updateTenantSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    // Só dígitos (a máscara é da UI). `null` limpa o campo.
    cnpj: z
      .string()
      .transform((v) => v.replace(/\D/g, ""))
      .pipe(z.string().length(14, "CNPJ deve ter 14 dígitos"))
      .nullable()
      .optional(),
    creci: z.string().max(40).nullable().optional(),
    domain: z.string().max(255).nullable().optional(),
    logoUrl: z.string().max(1_000_000).nullable().optional(),
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
  cnpj: string | null;
  creci: string | null;
  domain: string | null;
  logoUrl: string | null;
  plan: string;
  status: TenantStatus;
  /** Organização Clerk correspondente (org = tenant); nulo no dev-mode. */
  clerkOrgId: string | null;
  createdAt: string;
  updatedAt: string;
}
