import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Colunas `DATE` voltam como string `YYYY-MM-DD`, e não como `Date`.
 *
 * O default do node-postgres constrói um `Date` na MEIA-NOITE LOCAL do processo.
 * Como o código formata de volta com `.toISOString().slice(0, 10)` (UTC), todo
 * servidor a leste de Greenwich devolveria o DIA ANTERIOR em vencimento, data de
 * nascimento e admissão. Uma data de calendário não tem fuso: tratá-la como
 * texto elimina a classe de bug inteira, e o formato já é o que os schemas zod
 * esperam. `1082` é o OID do tipo `date`.
 */
pg.types.setTypeParser(1082, (value: string) => value);

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

/**
 * Serializa a geração de um código sequencial por tenant.
 *
 * O padrão `INSERT ... (SELECT MAX(code) + 1 ...)` parece atômico mas não é: em
 * READ COMMITTED, duas transações concorrentes leem o mesmo MAX e gravam o mesmo
 * número. Onde existe índice único isso vira erro (antes, um 500); onde não
 * existe, vira dois "Contrato Nº 7" em silêncio — o pior dos dois.
 *
 * O lock é de transação (`_xact_`): liberado no COMMIT/ROLLBACK, sem risco de
 * ficar preso. A chave é (tenant, nome da sequência), então tenants diferentes e
 * entidades diferentes nunca esperam um pelo outro. `hashtext` reduz cada parte a
 * um int4, que é o que a função aceita.
 *
 * Precisa ser chamado DENTRO do `withTenant` que faz o INSERT — o lock só vale
 * enquanto aquela transação vive.
 */
export async function lockSequence(
  client: pg.PoolClient,
  tenantId: string,
  sequence: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
    tenantId,
    sequence,
  ]);
}

/**
 * Executa `fn` numa transação de escopo de PLATAFORMA: define
 * `app.platform = 'on'`, que é o que a policy de `tenants` aceita como
 * alternativa ao `app.tenant_id`.
 *
 * Existe para as operações que legitimamente atravessam tenants — listar/criar
 * tenants na área de Super Admin, e checar unicidade global de CNPJ/slug no
 * onboarding (quando ainda não há tenant). Antes essas consultas usavam
 * `pool.query` direto; a diferença é que agora o acesso irrestrito é **explícito
 * no código** e o resto do sistema fica coberto pelo RLS. Um `grep withPlatform`
 * lista toda a superfície que enxerga além de um tenant.
 *
 * NUNCA use isto em código de domínio — para dado de tenant existe `withTenant`.
 */
export async function withPlatform<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.platform', 'on', true)");
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

/**
 * Guard de fundação (PRD MOD-AUTH-01/AC-03, RN-01): o RLS é IGNORADO por
 * superusuários do Postgres. Se o backend conectar como superusuário, o
 * isolamento multi-tenant vaza silenciosamente. Falhamos o boot (fail-fast).
 */
export async function assertNotSuperuser(): Promise<void> {
  const { rows } = await pool.query<{ rolsuper: boolean }>(
    "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
  );
  if (rows[0]?.rolsuper) {
    throw new Error(
      "DATABASE_URL conecta como SUPERUSUÁRIO: o RLS seria ignorado e vazaria dados entre tenants. Use o papel app_user (não-superusuário).",
    );
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
