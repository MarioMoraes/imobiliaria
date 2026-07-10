import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Cliente Redis para cache e filas de curtíssimo prazo / rate limiting
 * (SPEC seções 7 e 11.6). `lazyConnect` evita derrubar o boot do backend
 * caso o Redis ainda não esteja de pé em dev.
 */
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});

redis.on("error", (err) => logger.warn({ err: err.message }, "redis indisponível"));

export async function connectRedis(): Promise<void> {
  try {
    await redis.connect();
    logger.info("redis conectado");
  } catch (err) {
    logger.warn({ err }, "não foi possível conectar ao redis (seguindo sem cache)");
  }
}
