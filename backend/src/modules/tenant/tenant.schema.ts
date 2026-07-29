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

/**
 * Logo da imobiliária. Fase 0: a imagem vai embutida como data URL na coluna
 * `logo_url`.
 *
 * O `regex` não é cosmético: sem ele o campo aceitava 1 MB de string arbitrária,
 * guardada crua e devolvida a todo cliente que lê o tenant — daria para gravar
 * `javascript:`, `data:text/html` ou uma URL `http://` interna e usar o cadastro
 * como beacon/carga armazenada, dependendo de onde a UI colocasse o valor. Mesma
 * proteção que `addPhotoSchema` já aplica às fotos de imóvel.
 *
 * `svg+xml` é aceito aqui (e não em fotos) porque marcas são vetoriais — o seed
 * já usa um — e o valor só é renderizado em `<img src=...>`, contexto em que o
 * navegador não executa script do SVG.
 */
const logoDataUrl = z
  .string()
  .max(1_000_000)
  .regex(
    /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/,
    "Logo inválido (esperado data URL de imagem em base64)",
  );

/** slug vira subdomínio (<slug>.officestecnologia.com.br). Único global. */
const tenantSlug = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9-]+$/, "Use apenas minúsculas, números e hífen");

export const createTenantSchema = z.object({
  name: z.string().min(2).max(200),
  slug: tenantSlug,
  domain: z.string().max(255).optional(),
  logoUrl: logoDataUrl.optional(),
  plan: z.string().max(40).default("free"),
});

export const updateTenantSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    slug: tenantSlug.optional(),
    // Só dígitos (a máscara é da UI). `null` limpa o campo.
    cnpj: z
      .string()
      .transform((v) => v.replace(/\D/g, ""))
      .pipe(z.string().length(14, "CNPJ deve ter 14 dígitos"))
      .nullable()
      .optional(),
    creci: z.string().max(40).nullable().optional(),
    domain: z.string().max(255).nullable().optional(),
    logoUrl: logoDataUrl.nullable().optional(),
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
