import { z } from "zod";

/**
 * MOD-AUTH-04 — Onboarding self-service (PRD seção 5).
 *
 * Fase 0: o wizard de 5 etapas é submetido em UM passo (sem persistência de
 * rascunho — retomada de wizard abandonado é TODO/AC-03). O visitante ainda não
 * tem sessão Clerk, então o e-mail/nome do primeiro ADMIN vêm no payload
 * (`admin`). Pós-Clerk (MOD-AUTH-05) isso passa a vir do token da sessão e o
 * campo `admin` deixa de ser necessário.
 */

const onboardingRoles = z.enum(["ADMIN", "GESTOR", "CORRETOR", "FINANCEIRO"]);

export const onboardingSchema = z.object({
  studio: z.object({
    name: z.string().min(2).max(200),
    cnpj: z.string().regex(/^\d{14}$/, "CNPJ deve ter 14 dígitos"),
    creci: z.string().max(40).optional(),
    // slug vira subdomínio (<slug>.officesai.com.br): minúsculas, números e hífen.
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{2,59}$/, "Use minúsculas, números e hífen (3–60)"),
  }),
  planId: z.string().max(40).optional(),
  // No fluxo Clerk o admin vem da sessão (fetch no Clerk). Só é exigido no
  // dev-mode (sem token), onde não há identidade externa — validado no service.
  admin: z
    .object({
      email: z.string().email(),
      fullName: z.string().min(2).max(200),
    })
    .optional(),
  invites: z
    .array(z.object({ email: z.string().email(), role: onboardingRoles }))
    .optional(),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export interface OnboardedUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  roles: string[];
  status: string;
}
