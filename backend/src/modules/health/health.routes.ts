import type { FastifyInstance } from "fastify";
import { checkDatabase } from "../../shared/db.js";

/**
 * Health checks (SPEC seções 4.1 e 10). Sem contexto de tenant.
 * - /health         → liveness (o processo responde)
 * - /health/ready   → readiness (dependências essenciais de pé)
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

  app.get("/health/ready", async (_req, reply) => {
    const db = await checkDatabase();
    const ready = db;
    reply.code(ready ? 200 : 503);
    return { status: ready ? "ready" : "not_ready", checks: { database: db } };
  });
}
