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
  | "TOO_MANY_REQUESTS"
  | "INTERNAL"
  // Códigos canônicos do MOD-AUTH (PRD seção 5). São a referência herdada por
  // todos os módulos; emitidos no campo `code` do corpo de erro.
  | "ERR_AUTH_003" // papel insuficiente para a operação
  | "ERR_AUTH_004" // conflito (CNPJ/slug/email duplicado)
  | "ERR_AUTH_005" // tenant não resolvido
  | "ERR_AUTH_006" // tenant suspenso/inativo
  | "ERR_AUTH_007" // usuário sem papel ativo
  | "ERR_AUTH_008" // token válido, mas sem claim tenant_id (usuário sem organização)
  | "ERR_AUTH_009" // claim tenant_id não corresponde à organização do token
  // Códigos do MOD-FUNC (PRD funcionarios §5).
  | "ERR_FUNC_001" // funcionário não encontrado
  | "ERR_FUNC_004" // identidade duplicada (CPF/e-mail)
  | "ERR_FUNC_005" // último ADMIN não pode ser removido
  | "ERR_FUNC_006" // falha ao enviar o convite ao membro (Clerk)
  | "ERR_FUNC_007" // reenvio pedido para membro que já aceitou o convite
  | "ERR_FUNC_008" // tenant sem organização no Clerk — convites indisponíveis
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
  | "ERR_ASSINATURA_004" // envelope de assinatura não encontrado
  // Códigos do MOD-FIN (financeiro_11 §5).
  | "ERR_FIN_001" // conta a receber não encontrada
  | "ERR_FIN_002" // operação inválida (ex.: cobrança bancária não configurada)
  // Códigos do envio de e-mail transacional (shared/mailer.ts / Resend).
  | "ERR_MAIL_001" // envio não configurado (RESEND_API_KEY ausente)
  | "ERR_MAIL_002" // provedor inalcançável
  | "ERR_MAIL_003" // credencial/remetente recusados (domínio não verificado)
  | "ERR_MAIL_004"; // provedor recusou o envio

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

  /**
   * Token de sessão válido, porém sem o claim `tenant_id` — o usuário está
   * autenticado mas não pertence a nenhuma organização (não fez onboarding).
   * Diferente de `tenantNotResolved`: aqui a identidade FOI verificada, e é o
   * único caso em que o fallback de dev pode assumir um tenant (ver
   * `resolveAuth`). Confundir os dois é o que permitia usar um token inválido
   * para entrar em qualquer tenant pelo header.
   */
  static tenantClaimMissing(message = "Token sem claim tenant_id") {
    return new AppError("ERR_AUTH_008", 401, message);
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

/**
 * Erros do Postgres que descrevem um problema do PEDIDO, não do servidor.
 *
 * Sem esse mapeamento, violar uma constraint (CNPJ repetido, código sequencial em
 * corrida, FK inexistente, uuid malformado na URL) devolvia 500 INTERNAL e um log
 * de "erro não tratado" — o cliente não tinha como saber que a culpa era do
 * próprio pedido, e o log enchia de falso positivo.
 *
 * Só os códigos que temos certeza de serem culpa do cliente entram aqui; o resto
 * segue para 500, que é o comportamento seguro.
 */
const PG_ERRORS: Record<string, { status: number; code: ErrorCode; message: string }> = {
  // unique_violation
  "23505": {
    status: 409,
    code: "CONFLICT",
    message: "Registro já existente (valor duplicado).",
  },
  // foreign_key_violation
  "23503": {
    status: 400,
    code: "BAD_REQUEST",
    message: "Referência inválida: o registro relacionado não existe.",
  },
  // not_null_violation
  "23502": {
    status: 400,
    code: "BAD_REQUEST",
    message: "Campo obrigatório ausente.",
  },
  // check_violation
  "23514": {
    status: 400,
    code: "BAD_REQUEST",
    message: "Valor fora do permitido para o campo.",
  },
  // invalid_text_representation (ex.: 'abc' onde se espera uuid)
  "22P02": {
    status: 400,
    code: "BAD_REQUEST",
    message: "Identificador ou valor em formato inválido.",
  },
  // string_data_right_truncation
  "22001": {
    status: 400,
    code: "BAD_REQUEST",
    message: "Valor mais longo que o permitido para o campo.",
  },
  // numeric_value_out_of_range
  "22003": {
    status: 400,
    code: "BAD_REQUEST",
    message: "Valor numérico fora da faixa permitida.",
  },
};

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

  // Erro do driver do Postgres: `code` é o SQLSTATE. Nunca repassamos a mensagem
  // do banco (ela revela nome de tabela, coluna e constraint) — só a nossa.
  const pgCode = (err as { code?: unknown })?.code;
  if (typeof pgCode === "string") {
    const mapped = PG_ERRORS[pgCode];
    if (mapped) {
      return {
        statusCode: mapped.status,
        body: { error: { code: mapped.code, message: mapped.message } },
      };
    }
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
