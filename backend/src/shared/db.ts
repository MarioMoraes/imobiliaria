import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Pool de conexões PostgreSQL. O backend conecta como `app_user`
 * (não-superusuário) para que as policies de RLS sejam efetivamente
 * aplicadas (ver infra/postgres/init.sql).
 */
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

pool.on("error", (err) => logger.error({ err }, "erro inesperado no pool do postgres"));

/**
 * Executa `fn` dentro de uma transação com o tenant corrente definido via
 * `set_config('app.tenant_id', <uuid>, true)`. O `true` torna o parâmetro
 * local à transação — ele é limpo automaticamente no COMMIT/ROLLBACK, o que
 * evita vazamento de tenant entre conexões reaproveitadas do pool.
 *
 * Toda leitura/escrita de dado de domínio DEVE passar por aqui. Isso é o
 * que ativa o isolamento multi-tenant garantido pelo RLS.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabase(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    logger.error({ err }, "healthcheck do banco falhou");
    return false;
  }
}
