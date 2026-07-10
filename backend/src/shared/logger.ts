import { pino, type LoggerOptions } from "pino";
import { env } from "../config/env.js";

/**
 * Opções de log estruturado (SPEC seção 10). Compartilhadas entre o logger
 * standalone (usado fora do ciclo de request: db, events, bootstrap) e o
 * Fastify (que instancia seu próprio logger a partir destas opções, evitando
 * incompatibilidade de tipos). Em dev usa pino-pretty; em prod, JSON.
 */
export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
      }
    : {}),
};

export const logger = pino(loggerOptions);
