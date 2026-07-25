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

/**
 * Papéis que um ADMIN de tenant pode CONCEDER. `SUPER_ADMIN` fica de fora de
 * propósito: é papel de plataforma, e permitir concedê-lo daria a qualquer
 * administrador de imobiliária um caminho para se promover a administrador do
 * produto (inclusive para si mesmo). A administração da plataforma tem
 * identidade própria — ver `gateway/platform-admin.hook.ts`.
 *
 * `userRole` acima continua com o conjunto completo, porque leitura precisa
 * saber ler um papel que exista no banco.
 */
export const assignableRole = z.enum([
  "ADMIN",
  "GESTOR",
  "FINANCEIRO",
  "CORRETOR",
  "PROPRIETARIO",
  "CLIENTE",
  "AI_AGENT",
]);
export type AssignableRole = z.infer<typeof assignableRole>;

export const changeRoleSchema = z.object({ role: assignableRole });
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export interface UserWithRoles {
  id: string;
  email: string;
  fullName: string;
  status: string;
  roles: string[];
}
