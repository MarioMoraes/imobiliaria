import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { loggerOptions } from "./shared/logger.js";
import { toErrorBody } from "./shared/errors.js";
import { registerRoutes } from "./gateway/routes.js";

/**
 * Constrói a instância Fastify (sem iniciar o listen — facilita testes).
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    genReqId: () => randomUUID(),
    // Fotos são enviadas embutidas (data URL base64) na Fase 0 — o default de
    // 1 MB do Fastify é apertado. 8 MB dá folga (o cliente já comprime).
    bodyLimit: 8 * 1024 * 1024,
    // Só em deploy atrás de proxy reverso (ver TRUST_PROXY em config/env).
    // É o que faz `req.ip` ser o IP real do cliente — de onde o rate limit tira
    // a chave do balde e o log tira o `remoteAddress`.
    trustProxy: env.TRUST_PROXY,
  });

  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });

  // Rate limit com `global: false`: vale só onde a rota pede, via
  // `config: { rateLimit: ... }`. As rotas de domínio já exigem sessão e papel,
  // então o alvo aqui são as superfícies alcançáveis SEM autenticação — em
  // especial os webhooks, cujo segredo por tenant é comparado em tempo constante
  // mas não tinha limite de tentativas (força bruta offline-free).
  await app.register(rateLimit, {
    global: false,
    // Mensagem no nosso formato de erro (SPEC 15), senão o plugin responde num
    // formato próprio e o frontend não sabe ler.
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: {
        code: "TOO_MANY_REQUESTS",
        message: `Muitas tentativas. Tente novamente em ${Math.ceil(ctx.ttl / 1000)}s.`,
      },
    }),
  });

  // Handler de erro padronizado (formato único — SPEC 15).
  app.setErrorHandler((err, req, reply) => {
    const { statusCode, body } = toErrorBody(err);
    if (statusCode >= 500) req.log.error({ err }, "erro não tratado");
    reply.code(statusCode).send(body);
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: { code: "NOT_FOUND", message: "Rota não encontrada" } });
  });

  await registerRoutes(app);
  return app;
}
