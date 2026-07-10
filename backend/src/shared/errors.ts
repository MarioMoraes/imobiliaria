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
  | "INTERNAL";

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
  return {
    statusCode: 500,
    body: { error: { code: "INTERNAL", message: "Erro interno do servidor" } },
  };
}
