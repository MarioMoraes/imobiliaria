/**
 * Matriz de controle de acesso canônica (PRD MOD-AUTH seção 9) — a referência
 * herdada por todos os módulos. Mapeia cada operação ao conjunto de papéis que
 * podem executá-la. `can()` é a verificação pura, sem HTTP/DB (fácil de testar).
 *
 * Escopos por "próprios/atribuídos" (ex.: corretor só edita os próprios imóveis)
 * são refinados na camada de service; aqui garantimos o gate de papel.
 *
 * `AUXILIAR` é o Auxiliar Administrativo: alimenta o sistema no dia a dia
 * (cadastros, contratos, documentos) e consulta o financeiro, mas **não apaga
 * nada** — nenhum `*:delete` — nem toca em usuários, configuração do tenant ou
 * movimento de dinheiro. Ver a nota em `MATRIX` abaixo.
 */
export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "GESTOR"
  | "FINANCEIRO"
  | "CORRETOR"
  | "AUXILIAR"
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
  | "contract:delete"
  | "crm:read"
  | "crm:write"
  | "person:read"
  | "person:write"
  | "person:delete"
  | "condominium:read"
  | "condominium:write"
  | "condominium:delete"
  | "broker:read"
  | "broker:write"
  | "broker:delete"
  | "document:read"
  | "document:write"
  | "document:delete"
  | "ai:use"
  | "ai:read"
  | "ai:admin";

/**
 * Nota sobre `AUXILIAR` (Auxiliar Administrativo): ele aparece em toda leitura
 * e em toda escrita do operacional, e em **nenhum** `*:delete`. Essa é a linha
 * que define o papel — quem alimenta o sistema o dia inteiro é justamente quem
 * mais erra por pressa, e apagar imóvel, pessoa ou documento não tem desfazer.
 * Também fica fora de `users:*`, `tenant:config:*` e `finance:write`: cuidar do
 * cadastro não é o mesmo que decidir quem entra ou para onde vai o dinheiro.
 */
const MATRIX: Record<Operation, Role[]> = {
  "users:read": ["SUPER_ADMIN", "ADMIN", "GESTOR"],
  "users:manage": ["SUPER_ADMIN", "ADMIN"],
  "tenant:config:read": ["SUPER_ADMIN", "ADMIN", "GESTOR"],
  "tenant:config:write": ["SUPER_ADMIN", "ADMIN"],
  "property:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "FINANCEIRO", "CORRETOR", "AUXILIAR", "AI_AGENT"],
  "property:write": ["SUPER_ADMIN", "ADMIN", "GESTOR", "CORRETOR", "AUXILIAR"],
  "property:delete": ["SUPER_ADMIN", "ADMIN"],
  // AUXILIAR lê (precisa dizer ao inquilino o que está em aberto) mas não
  // movimenta: baixa, emissão de cobrança e repasse ficam com o financeiro.
  "finance:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "FINANCEIRO", "AUXILIAR"],
  "finance:write": ["SUPER_ADMIN", "ADMIN", "FINANCEIRO"],
  "contract:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "FINANCEIRO", "CORRETOR", "AUXILIAR"],
  "contract:write": ["SUPER_ADMIN", "ADMIN", "GESTOR", "CORRETOR", "AUXILIAR"],
  "contract:delete": ["SUPER_ADMIN", "ADMIN"],
  "crm:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "CORRETOR", "AUXILIAR"],
  "crm:write": ["SUPER_ADMIN", "ADMIN", "GESTOR", "CORRETOR", "AUXILIAR"],
  // Pessoas (MOD-PESSOA: locador/locatário/fiador). AI_AGENT
  // cria/atualiza mas NUNCA deleta (RN-04).
  "person:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "CORRETOR", "AUXILIAR"],
  "person:write": ["SUPER_ADMIN", "ADMIN", "GESTOR", "CORRETOR", "AUXILIAR", "AI_AGENT"],
  "person:delete": ["SUPER_ADMIN", "ADMIN", "GESTOR"],
  // Condomínios (MOD-CONDOMINIO) — cadastro + parâmetros financeiros de
  // cobrança. FINANCEIRO lê (repasse/boletos); escrita/remoção fica com gestão.
  "condominium:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "FINANCEIRO", "AUXILIAR"],
  "condominium:write": ["SUPER_ADMIN", "ADMIN", "GESTOR", "AUXILIAR"],
  "condominium:delete": ["SUPER_ADMIN", "ADMIN"],
  // Corretores (MOD-CORRETOR) — cadastro de parceiros. Gestão escreve; ADMIN remove.
  "broker:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "FINANCEIRO", "CORRETOR", "AUXILIAR"],
  "broker:write": ["SUPER_ADMIN", "ADMIN", "GESTOR"],
  "broker:delete": ["SUPER_ADMIN", "ADMIN"],
  // Documentos (MOD-DOC) — RG, comprovante de renda, matrícula. FINANCEIRO lê
  // (precisa conferir o que sustenta um repasse) mas não anexa. O `delete` é o
  // expurgo LGPD: apaga o binário de todas as versões e não tem volta, por isso
  // fica só com quem responde pelo tenant.
  "document:read": ["SUPER_ADMIN", "ADMIN", "GESTOR", "FINANCEIRO", "CORRETOR", "AUXILIAR"],
  "document:write": ["SUPER_ADMIN", "ADMIN", "GESTOR", "CORRETOR", "AUXILIAR"],
  "document:delete": ["SUPER_ADMIN", "ADMIN"],
  // Camada de IA (MOD-AI). `ai:use` é perguntar ao copiloto — quem opera o dia
  // a dia. Note que AI_AGENT NÃO está aqui: ele é a identidade dos canais
  // externos (o cliente final, sem sessão), não de quem consome o copiloto
  // interno. Dentro da conversa, cada ferramenta é reavaliada contra os papéis
  // de quem perguntou (ver tools/registry.ts), então `ai:use` não é um atalho
  // para ler o que o papel não alcança.
  "ai:use": ["SUPER_ADMIN", "ADMIN", "GESTOR", "FINANCEIRO", "CORRETOR", "AUXILIAR"],
  // Histórico das conversas e saldo de créditos: é auditoria (pode conter o que
  // outra pessoa perguntou), por isso fica com a gestão.
  "ai:read": ["SUPER_ADMIN", "ADMIN", "GESTOR"],
  // Reindexação completa do RAG — operação cara, varre o inventário inteiro.
  "ai:admin": ["SUPER_ADMIN", "ADMIN"],
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
