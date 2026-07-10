import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env.js";
import { loggerOptions } from "./shared/logger.js";
import { toErrorBody } from "./shared/errors.js";
import { registerRoutes } from "./gateway/routes.js";

/**
 * Constrói a instância Fastify (sem iniciar o listen — facilita testes).
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions, genReqId: () => randomUUID() });

  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });

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
