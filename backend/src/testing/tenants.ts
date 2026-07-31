import { randomUUID } from "node:crypto";
import { after } from "node:test";
import { withPlatform } from "../shared/db.js";
import { create } from "../modules/tenant/tenant.service.js";
import type { CreateTenantInput, Tenant } from "../modules/tenant/tenant.schema.js";

/**
 * Fixture de tenant para os testes — cria e, ao fim do arquivo, DESFAZ.
 *
 * Testar isolamento multi-tenant exige tenants de verdade (um por caso, senão os
 * casos enxergam os dados uns dos outros), e cada arquivo criava os seus sem
 * nunca removê-los: em duas semanas a tabela passou de 1.600 linhas, que
 * apareciam na listagem do Super Admin misturadas às imobiliárias reais.
 *
 * Importar este módulo já registra o `after` de limpeza — o teste não precisa
 * lembrar de nada além de criar o tenant por aqui. O runner do Node roda cada
 * arquivo em um processo próprio, então o conjunto abaixo é sempre o daquele
 * arquivo.
 */

/** Ids criados neste arquivo de teste, na ordem em que nasceram. */
const created = new Set<string>();

/** Slug único no padrão que `scripts/prune-test-tenants.ts` reconhece. */
export function testSlug(prefix = "t"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * Marca um tenant para remoção. Use quando ele nasceu por outro caminho que não
 * o `createTestTenant` — o `onboarding()`, por exemplo, que cria tenant e ADMIN
 * numa transação só e é o próprio objeto sob teste.
 */
export function trackTenant<T extends { id: string }>(tenant: T): T {
  created.add(tenant.id);
  return tenant;
}

/** Cria um tenant descartável (slug aleatório, plano free) e o marca. */
export async function createTestTenant(name: string): Promise<Tenant> {
  return trackTenant(await create({ name, slug: testSlug(), plan: "free" }));
}

/**
 * Mesma assinatura do `create` do serviço, para os casos que precisam controlar
 * slug/plano (ex.: os testes de conflito de slug em `tenant.test.ts`).
 */
export async function createTrackedTenant(input: CreateTenantInput): Promise<Tenant> {
  return trackTenant(await create(input));
}

after(async () => {
  if (created.size === 0) return;
  // Em lote e sob escopo de plataforma: a policy de `tenants` não deixaria um
  // DELETE passar sem ele. As 42 FKs que apontam para a tabela são ON DELETE
  // CASCADE, então imóveis, pessoas, usuários e auditoria saem junto.
  await withPlatform(async (client) => {
    await client.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[...created]]);
  });
  created.clear();
});
