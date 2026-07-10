import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./shared/logger.js";
import { pool } from "./shared/db.js";
import { connectRedis, redis } from "./shared/redis.js";
import { connectEvents } from "./shared/events.js";

async function main(): Promise<void> {
  // Dependências opcionais em dev: conectam de forma tolerante a falha.
  await Promise.all([connectRedis(), connectEvents()]);

  const app = await buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(`backend ouvindo em http://localhost:${env.PORT}`);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "encerrando...");
    await app.close();
    await pool.end().catch(() => {});
    redis.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "falha ao iniciar o backend");
  process.exit(1);
});
