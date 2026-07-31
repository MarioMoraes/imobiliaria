/**
 * Remove do banco os tenants criados pelos TESTES.
 *
 * Por que existe: a suíte cria um tenant por caso (isolamento multi-tenant só se
 * testa com tenants de verdade) e não desfaz nada ao terminar. Em duas semanas
 * de desenvolvimento isso virou mais de 1.600 linhas em `tenants`, que aparecem
 * na listagem do Super Admin misturadas às imobiliárias reais.
 *
 * Como reconhece um tenant de teste — os DOIS critérios precisam valer:
 *  1. o slug segue um dos padrões gerados pelos testes (`t-<hex8>` de
 *     tenant/rbac/person/employee.test.ts, `nova-<hex8>` de auth.test.ts).
 *     Slug é a chave certa para isso: é único e ninguém digita um desses à mão;
 *  2. o tenant NÃO tem `clerk_org_id`. Imobiliária real nasce pelo onboarding,
 *     que sempre grava a organização do Clerk. É a trava que garante que um
 *     cliente de verdade não pode casar com o padrão nem por acidente.
 *
 * O tenant demo do seed (`init.sql`) é protegido por id, à parte dos critérios.
 *
 * Uso (a partir da raiz do monorepo):
 *   npm run db:prune-test-tenants              # dry-run: só lista
 *   npm run db:prune-test-tenants -- --apply   # apaga de verdade
 *
 * A remoção é `DELETE FROM tenants`: as 42 chaves estrangeiras que apontam para
 * a tabela são `ON DELETE CASCADE`, então imóveis, pessoas, contratos e trilha
 * de auditoria daquele tenant saem junto. Roda em uma transação só.
 */
import { pool, withPlatform } from "../src/shared/db.js";

/** Tenant do seed — nunca entra na conta, aconteça o que acontecer. */
const DEMO_TENANT_ID = "00000000-0000-0000-0000-000000000001";

/** Padrões de slug que os testes geram (ver os `*.test.ts` citados acima). */
const TEST_SLUG_PATTERN = "^(t|nova)-[0-9a-f]{8}$";

interface Row {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const { doomed, keptCount } = await withPlatform(async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT id, name, slug, created_at
         FROM tenants
        WHERE slug ~ $1
          AND clerk_org_id IS NULL
          AND id <> $2
        ORDER BY created_at`,
      [TEST_SLUG_PATTERN, DEMO_TENANT_ID],
    );
    const { rows: total } = await client.query<{ count: string }>(
      "SELECT count(*) FROM tenants",
    );
    return { doomed: rows, keptCount: Number(total[0]!.count) - rows.length };
  });

  if (doomed.length === 0) {
    console.log("Nenhum tenant de teste encontrado. Nada a fazer.");
    return;
  }

  console.log(`Tenants de teste encontrados: ${doomed.length}`);
  console.log(`Tenants que permanecem:       ${keptCount}`);
  console.log();
  summarize(doomed);

  if (!apply) {
    console.log();
    console.log("DRY-RUN — nada foi apagado.");
    console.log("Para executar: npm run db:prune-test-tenants -- --apply");
    return;
  }

  // Uma transação só: ou some tudo, ou não some nada. Deletar em lote (e não um
  // a um) também evita 1.600 idas ao banco.
  const removed = await withPlatform(async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM tenants
        WHERE slug ~ $1
          AND clerk_org_id IS NULL
          AND id <> $2`,
      [TEST_SLUG_PATTERN, DEMO_TENANT_ID],
    );
    return rowCount ?? 0;
  });

  console.log();
  console.log(`Removidos: ${removed} tenants (com todos os dados em cascata).`);
  await listSurvivors();
}

/** Agrupa por nome para o dry-run caber na tela mesmo com milhares de linhas. */
function summarize(rows: Row[]): void {
  const byName = new Map<string, number>();
  for (const r of rows) byName.set(r.name, (byName.get(r.name) ?? 0) + 1);
  for (const [name, count] of [...byName].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${name}`);
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first && last) {
    console.log();
    console.log(
      `  Exemplos: ${first.slug} (${first.created_at.toISOString().slice(0, 10)})` +
        ` … ${last.slug} (${last.created_at.toISOString().slice(0, 10)})`,
    );
  }
}

/** Mostra o que sobrou — a conferência que importa depois de um DELETE em massa. */
async function listSurvivors(): Promise<void> {
  const rows = await withPlatform(async (client) => {
    const { rows } = await client.query<{ name: string; slug: string; org: string | null }>(
      "SELECT name, slug, clerk_org_id AS org FROM tenants ORDER BY created_at",
    );
    return rows;
  });
  console.log();
  console.log(`Tenants restantes (${rows.length}):`);
  for (const r of rows) {
    console.log(`  ${r.name} · ${r.slug} · org=${r.org ?? "—"}`);
  }
}

try {
  await main();
} finally {
  await pool.end();
}
