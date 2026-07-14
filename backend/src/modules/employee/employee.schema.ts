import { z } from "zod";

/**
 * Funcionário / colaborador interno (MOD-FUNC). É um `users` (MOD-AUTH) com
 * papel(is) RBAC + metadados de RH (cargo, admissão) e um estado de acesso.
 * Papéis internos aceitos aqui são um subconjunto dos papéis-padrão: o portal
 * externo (PROPRIETARIO/CLIENTE) e o CORRETOR têm cadastros próprios; AI_AGENT
 * é ator não-humano; SUPER_ADMIN é nível-plataforma. Ver PRD funcionarios §5.
 * TODO: cifrar cpf em repouso (AES-256-GCM).
 */

/** Papéis atribuíveis a um funcionário interno. */
export const employeeRole = z.enum(["ADMIN", "GESTOR", "FINANCEIRO"]);
export type EmployeeRole = z.infer<typeof employeeRole>;

export const employeeAccessStatus = z.enum(["ATIVO", "SUSPENSO", "REVOGADO"]);
export type EmployeeAccessStatus = z.infer<typeof employeeAccessStatus>;

/**
 * Validação de CPF por dígitos verificadores (módulo 11). Aceita a entrada
 * com ou sem máscara; o valor é normalizado (só dígitos) antes de persistir.
 */
export function isValidCpf(raw: string): boolean {
  const cpf = raw.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digits = cpf.split("").map(Number) as number[];
  for (let check = 9; check < 11; check++) {
    let sum = 0;
    for (let i = 0; i < check; i++) sum += digits[i]! * (check + 1 - i);
    const verifier = ((sum * 10) % 11) % 10;
    if (verifier !== digits[check]) return false;
  }
  return true;
}

export const cpfField = z
  .string()
  .refine(isValidCpf, "CPF inválido")
  .transform((v) => v.replace(/\D/g, ""));

export const createEmployeeSchema = z.object({
  fullName: z.string().min(2).max(200),
  cpf: cpfField,
  email: z.string().email(),
  position: z.string().min(2).max(120),
  roles: z.array(employeeRole).min(1),
  hiredAt: z.string().date().optional(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/** Atualização de cargo e/ou papéis (MOD-FUNC-02). */
export const updateEmployeeSchema = z
  .object({
    position: z.string().min(2).max(120).optional(),
    roles: z.array(employeeRole).min(1).optional(),
    hiredAt: z.string().date().nullable().optional(),
  })
  .refine((d) => d.position !== undefined || d.roles !== undefined || d.hiredAt !== undefined, {
    message: "Nada para atualizar",
  });
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

/** Transição de acesso (MOD-FUNC-03): ATIVO ⇄ SUSPENSO, * → REVOGADO. */
export const changeAccessSchema = z.object({ status: employeeAccessStatus });
export type ChangeAccessInput = z.infer<typeof changeAccessSchema>;

export interface Employee {
  id: string;
  tenantId: string;
  userId: string;
  fullName: string;
  email: string;
  cpf: string;
  position: string;
  hiredAt: string | null;
  accessStatus: EmployeeAccessStatus;
  /** users.status: 'invited' (convite pendente) | 'active' | 'disabled'. */
  userStatus: string;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}
