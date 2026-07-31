import assert from "node:assert/strict";
import { test } from "node:test";
import { withTenant } from "../../shared/db.js";
import { addParty, insertContract, listContracts } from "./contract.repository.js";
import { createContractSchema } from "./contract.schema.js";
import { linkOwnersAsLocador } from "./contract.service.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) — obrigatório no CI.
 *
 * Garante que contratos de um tenant nunca vazam para outro. Depende do banco
 * containerizado (`npm run infra:up`).
 *
 * Rode com: npm test   (node --test)
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("contract")).id;
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

test("um contrato criado num tenant não é visível por outro tenant", async () => {
  const created = await insertContract(
    TENANT,
    createContractSchema.parse({ status: "RASCUNHO", readjustIndex: "IPCA" }),
  );

  const visibleToDemo = await listContracts(TENANT);
  assert.ok(
    visibleToDemo.some((c) => c.id === created.id),
    "o tenant dono deve enxergar o próprio contrato",
  );

  const visibleToOther = await listContracts(OTHER_TENANT);
  assert.ok(
    !visibleToOther.some((c) => c.id === created.id),
    "TENANT LEAKAGE: outro tenant não pode enxergar o contrato",
  );
});

/* ------------------------- Locador vindo do dono do imóvel ------------------ */

/**
 * Imóvel COM proprietário vinculado, montado aqui. Antes o teste garimpava um no
 * seed e se auto-pulava quando não achava — deixava de cobrir a regra em
 * silêncio. Montar o cenário é o que garante que ele sempre roda.
 */
async function propertyWithOwner(): Promise<{ id: string; ownerName: string }> {
  const ownerName = "Dona do Imóvel";
  return withTenant(TENANT, async (client) => {
    const { rows: props } = await client.query<{ id: string }>(
      `INSERT INTO properties (tenant_id, title, kind, purpose, status)
       VALUES ($1, 'Imóvel com dono', 'rent', 'rent', 'available') RETURNING id`,
      [TENANT],
    );
    const propertyId = props[0]!.id;
    const { rows: people } = await client.query<{ id: string }>(
      `INSERT INTO persons (tenant_id, full_name, person_type, roles, source)
       VALUES ($1, $2, 'PF', ARRAY['LOCADOR'], 'MANUAL') RETURNING id`,
      [TENANT, ownerName],
    );
    await client.query(
      `INSERT INTO property_owners (tenant_id, property_id, person_id, share_percent)
       VALUES ($1, $2, $3, 100)`,
      [TENANT, propertyId, people[0]!.id],
    );
    return { id: propertyId, ownerName };
  });
}

async function dropContract(id: string): Promise<void> {
  await withTenant(TENANT, async (client) => {
    await client.query("DELETE FROM contracts WHERE id = $1", [id]);
  });
}

test("o proprietário do imóvel entra como LOCADOR do contrato", async () => {
  const property = await propertyWithOwner();

  const contract = await insertContract(
    TENANT,
    createContractSchema.parse({ propertyId: property.id }),
  );

  try {
    const linked = await linkOwnersAsLocador(TENANT, contract.id);
    const locadores = linked.parties.filter((p) => p.role === "LOCADOR");
    assert.equal(locadores.length, 1);
    assert.equal(locadores[0]?.personName, property.ownerName);

    // Idempotente: chamar de novo não duplica a parte.
    const again = await linkOwnersAsLocador(TENANT, contract.id);
    assert.equal(again.parties.filter((p) => p.role === "LOCADOR").length, 1);
  } finally {
    await dropContract(contract.id);
  }
});

test("um locador escolhido à mão nunca é substituído pelo dono do imóvel", async () => {
  const property = await propertyWithOwner();

  const contract = await insertContract(
    TENANT,
    createContractSchema.parse({ propertyId: property.id }),
  );

  try {
    // Procurador/espólio no lugar do proprietário registrado.
    const outra = await withTenant(TENANT, async (client) => {
      const { rows } = await client.query<{ id: string; full_name: string }>(
        `SELECT id, full_name FROM persons
          WHERE id <> (SELECT person_id FROM property_owners WHERE property_id = $1 LIMIT 1)
          LIMIT 1`,
        [property.id],
      );
      return rows[0]!;
    });
    await addParty(TENANT, contract.id, "LOCADOR", outra.id);

    const linked = await linkOwnersAsLocador(TENANT, contract.id);
    const locadores = linked.parties.filter((p) => p.role === "LOCADOR");
    assert.equal(locadores.length, 1, "o dono do imóvel não pode ser somado à escolha manual");
    assert.equal(locadores[0]?.personName, outra.full_name);
  } finally {
    await dropContract(contract.id);
  }
});

test("contrato sem imóvel não ganha locador", async () => {
  const contract = await insertContract(TENANT, createContractSchema.parse({}));
  try {
    const linked = await linkOwnersAsLocador(TENANT, contract.id);
    assert.equal(linked.parties.length, 0);
  } finally {
    await dropContract(contract.id);
  }
});
