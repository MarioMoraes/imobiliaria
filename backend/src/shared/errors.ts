/**
 * Formato único de erro de API (SPEC seção 15), consumido de forma
 * previsível pelo frontend e pelos agentes de IA:
 *   { "error": { "code": "...", "message": "...", "details": {...} } }
 */
export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "TENANT_REQUIRED"
  | "CONFLICT"
  | "INTERNAL"
  // Códigos canônicos do MOD-AUTH (PRD seção 5). São a referência herdada por
  // todos os módulos; emitidos no campo `code` do corpo de erro.
  | "ERR_AUTH_003" // papel insuficiente para a operação
  | "ERR_AUTH_004" // conflito (CNPJ/slug/email duplicado)
  | "ERR_AUTH_005" // tenant não resolvido
  | "ERR_AUTH_006" // tenant suspenso/inativo
  | "ERR_AUTH_007" // usuário sem papel ativo
  // Códigos do MOD-FUNC (PRD funcionarios §5).
  | "ERR_FUNC_001" // funcionário não encontrado
  | "ERR_FUNC_004" // identidade duplicada (CPF/e-mail)
  | "ERR_FUNC_005" // último ADMIN não pode ser removido
  | "ERR_FUNC_006" // falha ao enviar o convite ao membro (Clerk)
  // Códigos do MOD-PESSOA (cadastro unificado: locador/locatário/fiador/comprador).
  | "ERR_PESSOA_001" // pessoa não encontrada
  | "ERR_PESSOA_002" // sem contato (email/telefone)
  | "ERR_PESSOA_004" // duplicata (retorna existingId)
  | "ERR_PESSOA_005" // transição de stage manual proibida (INQUILINO/COMPRADOR)
  // Códigos do MOD-CONTRATO (contratos_08 §5).
  | "ERR_CONTRATO_002" // locação sem garantia definida (bloqueia envio à assinatura)
  // Códigos do MOD-ASSINATURA (integração de assinatura eletrônica).
  | "ERR_ASSINATURA_001" // integração de assinatura não configurada no tenant
  | "ERR_ASSINATURA_002" // parte sem o contato exigido pelo modo de autenticação
  | "ERR_ASSINATURA_003" // contrato sem as partes mínimas para assinar
  | "ERR_ASSINATURA_004"; // envelope de assinatura não encontrado

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  static notFound(message = "Recurso não encontrado", details?: unknown) {
    return new AppError("NOT_FOUND", 404, message, details);
  }

  static badRequest(message = "Requisição inválida", details?: unknown) {
    return new AppError("BAD_REQUEST", 400, message, details);
  }

  static tenantRequired(message = "Contexto de tenant ausente") {
    return new AppError("TENANT_REQUIRED", 400, message);
  }

  /** Header/JWT ausente ou tenant inexistente — não foi possível resolver o tenant. */
  static tenantNotResolved(message = "Tenant não resolvido") {
    return new AppError("ERR_AUTH_005", 401, message);
  }

  /** Tenant existe mas está suspenso/inativo/cancelado. */
  static tenantSuspended(message = "Tenant suspenso") {
    return new AppError("ERR_AUTH_006", 403, message);
  }

  /** Conflito de unicidade (CNPJ, slug ou e-mail já cadastrado). */
  static conflict(message = "Recurso já cadastrado", details?: unknown) {
    return new AppError("ERR_AUTH_004", 409, message, details);
  }
}

export function toErrorBody(err: unknown): {
  statusCode: number;
  body: { error: { code: ErrorCode; message: string; details?: unknown } };
} {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      body: { error: { code: err.code, message: err.message, details: err.details } },
    };
  }
  // Erros do próprio Fastify (JSON malformado, corpo vazio com content-type
  // json, payload grande) já trazem um statusCode 4xx e uma mensagem útil.
  // Reportá-los como 500 esconde um erro do cliente atrás de "erro interno".
  const status = (err as { statusCode?: unknown })?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return {
      statusCode: status,
      body: {
        error: {
          code: status === 401 ? "UNAUTHORIZED" : status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Requisição inválida",
        },
      },
    };
  }

  return {
    statusCode: 500,
    body: { error: { code: "INTERNAL", message: "Erro interno do servidor" } },
  };
}
