import { z } from "zod";

/**
 * Papéis-padrão (PRD MOD-AUTH seção 4). O onboarding cria o primeiro usuário
 * como ADMIN; a gestão de papéis (aqui) permite ao ADMIN ajustar os demais.
 */
export const userRole = z.enum([
  "SUPER_ADMIN",
  "ADMIN",
  "GESTOR",
  "FINANCEIRO",
  "CORRETOR",
  "PROPRIETARIO",
  "CLIENTE",
  "AI_AGENT",
]);
export type UserRole = z.infer<typeof userRole>;

export const changeRoleSchema = z.object({ role: userRole });
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export interface UserWithRoles {
  id: string;
  email: string;
  fullName: string;
  status: string;
  roles: string[];
}
