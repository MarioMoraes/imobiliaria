import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { withPlatform, withTenant } from "./db.js";
import * as brokerRepo from "../modules/broker/broker.repository.js";

/**
 * Códigos sequenciais por tenant sob CONCORRÊNCIA.
 *
 * `INSERT ... (SELECT MAX(code) + 1 ...)` parece atômico e não é: em READ
 * COMMITTED, transações simultâneas leem o mesmo MAX e gravam o mesmo número.
 * O resultado era duas entidades com o mesmo código — em contrato, dois
 * "Contrato Nº 7". A correção tem duas partes, e as duas precisam existir:
 * `lockSequence` (serializa) e o índice único (transforma um escape em erro
 * visível, nunca em dado silenciosamente errado).
 *
 * O teste usa `broker` como representante: os quatro geradores (contrato, banco,
 * corretor, despesa de condomínio) seguem exatamente o mesmo padrão.
 *
 * Depende da infra de pé (`npm run infra:up`).
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
// Segundo tenant do teste. Diferente dos testes de LEITURA (que usam um id
// inexistente de propósito), aqui há INSERT: `brokers.tenant_id` tem FK para
// `tenants`, então a linha precisa existir de verdade.
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";
const criados: string[] = [];

before(async () => {
  // `tenants` tem RLS (self OR platform) — criar/apagar tenant é operação de
  // plataforma, por isso `withPlatform` e não `withTenant`.
  await withPlatform((client) =>
    client.query(
      `INSERT INTO tenants (id, name, slug, plan)
       VALUES ($1, 'Tenant de Teste (sequence)', $2, 'basic')
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_TENANT, `teste-sequence-${OTHER_TENANT.slice(-4)}`],
    ),
  );
});

after(async () => {
  await withTenant(DEMO_TENANT, (client) =>
    client.query("DELETE FROM brokers WHERE id = ANY($1::uuid[])", [criados]),
  );
  await withPlatform((client) => client.query("DELETE FROM tenants WHERE id = $1", [OTHER_TENANT]));
});

test("inserções concorrentes recebem códigos DISTINTOS", async () => {
  const marca = `Corretor Corrida ${Date.now()}`;

  // Paralelo de verdade: cada insert abre a própria conexão do pool, então as
  // transações se sobrepõem no tempo — é o cenário que produzia a duplicata.
  const criadosAgora = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      brokerRepo.insertBroker(DEMO_TENANT, { name: `${marca} ${i}`, commissionPercent: 0 }),
    ),
  );
  criadosAgora.forEach((b) => criados.push(b.id));

  const codes = criadosAgora.map((b) => b.code);
  assert.equal(
    new Set(codes).size,
    codes.length,
    `códigos duplicados sob concorrência: ${codes.join(", ")}`,
  );
});

test("o índice único é a rede de segurança (código repetido é recusado pelo banco)", async () => {
  const existente = await brokerRepo.insertBroker(DEMO_TENANT, {
    name: `Corretor Único ${Date.now()}`,
    commissionPercent: 0,
  });
  criados.push(existente.id);

  // Força o código à mão, ignorando o gerador — é o que uma corrida que
  // escapasse do lock produziria.
  await assert.rejects(
    () =>
      withTenant(DEMO_TENANT, (client) =>
        client.query(
          "INSERT INTO brokers (tenant_id, code, name, commission_percent) VALUES ($1, $2, $3, 0)",
          [DEMO_TENANT, existente.code, "Duplicata"],
        ),
      ),
    (err: { code?: string }) => err.code === "23505",
    "o banco precisa recusar (unique_violation), não aceitar em silêncio",
  );
});

test("o mesmo código PODE existir em tenants diferentes (o único é por tenant)", async () => {
  const a = await brokerRepo.insertBroker(DEMO_TENANT, {
    name: `A ${Date.now()}`,
    commissionPercent: 0,
  });
  criados.push(a.id);

  const b = await withTenant(OTHER_TENANT, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO brokers (tenant_id, code, name, commission_percent) VALUES ($1, $2, $3, 0) RETURNING id",
      [OTHER_TENANT, a.code, `B ${Date.now()}`],
    );
    return rows[0]!.id;
  });

  await withTenant(OTHER_TENANT, (client) =>
    client.query("DELETE FROM brokers WHERE id = $1", [b]),
  );
  assert.ok(b, "o código é sequencial DENTRO do tenant, não global");
});
