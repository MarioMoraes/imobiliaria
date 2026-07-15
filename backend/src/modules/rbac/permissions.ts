/**
 * Matriz de controle de acesso canônica (PRD MOD-AUTH seção 9) — a referência
 * herdada por todos os módulos. Mapeia cada operação ao conjunto de papéis que
 * podem executá-la. `can()` é a verificação pura, sem HTTP/DB (fácil de testar).
 *
 * Escopos por "próprios/atribuídos" (ex.: corretor só edita os próprios imóveis)
 * são refinados na camada de service; aqui garantimos o gate de papel.
 */
export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "GESTOR"
  | "FINANCEIRO"
  | "CORRETOR"
  | "PROPRIETARIO"
  | "CLIENTE"
  | "AI_AGENT";

export type Operation =
  | "users:read"
  | "users:manage"
  | "tenant:config:read"
  | "tenant:config:write"
  | "property:read"
  | "property:write"
  | "property:delete"
  | "finance:read"
  | "finance:write"
  | "contract:read"
  | "contract:write"
  | "crm:read"
  | "crm:write"
  | "person:read"
  | "person:write"
  | "person:delete"
  | "condominium:read"
  | "condominium:write"
  | "condominium:delete";

const MATRIX: Record<Operation, Role[]> = {
  "users:read": ["SUPER_ADMIN", "ADMIN", "GESTOR"],
  "users:manage": ["SUPER_ADMIN", "ADMIN"],
  "tenant:config:read": ["SUPER_ADMIN", "ADMIN", "GESTOR"],
  "tenant:config:write": ["SUPER_ADMIN", "ADMIN"],
  "property:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "FINANCEIRO", "CORRETOR", "AI_AGENT"],
  "property:write": ["SUPER_ADMIN", "ADMIN", "GESTOR", "CORRETOR"],
  "property:delete": ["SUPER_ADMIN", "ADMIN"],
  "finance:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "FINANCEIRO"],
  "finance:write": ["SUPER_ADMIN", "ADMIN", "FINANCEIRO"],
  "contract:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "FINANCEIRO", "CORRETOR"],
  "contract:write": ["SUPER_ADMIN", "ADMIN", "GESTOR"],
  "crm:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "CORRETOR"],
  "crm:write": ["SUPER_ADMIN", "ADMIN", "GESTOR", "CORRETOR"],
  // Pessoas (MOD-PESSOA: locador/locatário/fiador). AI_AGENT
  // cria/atualiza mas NUNCA deleta (RN-04).
  "person:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "CORRETOR"],
  "person:write": ["SUPER_ADMIN", "ADMIN", "GESTOR", "CORRETOR", "AI_AGENT"],
  "person:delete": ["SUPER_ADMIN", "ADMIN", "GESTOR"],
  // Condomínios (MOD-CONDOMINIO) — cadastro + parâmetros financeiros de
  // cobrança. FINANCEIRO lê (repasse/boletos); escrita/remoção fica com gestão.
  "condominium:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "FINANCEIRO"],
  "condominium:write": ["SUPER_ADMIN", "ADMIN", "GESTOR"],
  "condominium:delete": ["SUPER_ADMIN", "ADMIN"],
};

/** Papéis que podem executar `op`. */
export function rolesFor(op: Operation): readonly Role[] {
  return MATRIX[op];
}

/** true se algum dos papéis do usuário autoriza a operação. */
export function can(userRoles: readonly string[], op: Operation): boolean {
  const allowed = MATRIX[op];
  return userRoles.some((r) => (allowed as readonly string[]).includes(r));
}
