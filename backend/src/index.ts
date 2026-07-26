import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./shared/logger.js";
import { assertNotSuperuser, pool } from "./shared/db.js";
import { connectRedis, redis } from "./shared/redis.js";
import { closeEvents, connectEvents } from "./shared/events.js";
import { startRagConsumer } from "./modules/ai/rag/consumer.js";

async function main(): Promise<void> {
  // Fail-fast: nunca conectar como superusuário (RLS seria ignorado — RN-01).
  await assertNotSuperuser();

  // Dependências opcionais em dev: conectam de forma tolerante a falha.
  await Promise.all([connectRedis(), connectEvents()]);

  // Depois do connectEvents: o consumidor precisa do canal já aberto. Sem
  // RabbitMQ ele apenas não inicia, e o índice do RAG só atualiza pelo backfill
  // manual (POST /v1/ai/rag/reindex).
  await startRagConsumer();

  const app = await buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(`backend ouvindo em http://localhost:${env.PORT}`);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "encerrando...");
    await app.close();
    await closeEvents();
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
