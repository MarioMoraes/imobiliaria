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
 * containerizado (`npm run infra:up`) e do seed em init.sql (tenant demo).
 *
 * Rode com: npm test   (node --test)
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

test("um contrato criado no tenant demo não é visível por outro tenant", async () => {
  const created = await insertContract(
    DEMO_TENANT,
    createContractSchema.parse({ status: "RASCUNHO", readjustIndex: "IPCA" }),
  );

  const visibleToDemo = await listContracts(DEMO_TENANT);
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

/** Imóvel do seed que tem proprietário vinculado, com o nome do dono. */
async function propertyWithOwner(): Promise<{ id: string; ownerName: string } | null> {
  return withTenant(DEMO_TENANT, async (client) => {
    const { rows } = await client.query<{ id: string; owner_name: string }>(
      `SELECT p.id, pe.full_name AS owner_name
         FROM properties p
         JOIN property_owners po ON po.property_id = p.id
         JOIN persons pe ON pe.id = po.person_id
        ORDER BY p.created_at LIMIT 1`,
    );
    return rows[0] ? { id: rows[0].id, ownerName: rows[0].owner_name } : null;
  });
}

async function dropContract(id: string): Promise<void> {
  await withTenant(DEMO_TENANT, async (client) => {
    await client.query("DELETE FROM contracts WHERE id = $1", [id]);
  });
}

test("o proprietário do imóvel entra como LOCADOR do contrato", async (t) => {
  const property = await propertyWithOwner();
  if (!property) return t.skip("seed sem imóvel com proprietário vinculado");

  const contract = await insertContract(
    DEMO_TENANT,
    createContractSchema.parse({ propertyId: property.id }),
  );

  try {
    const linked = await linkOwnersAsLocador(DEMO_TENANT, contract.id);
    const locadores = linked.parties.filter((p) => p.role === "LOCADOR");
    assert.equal(locadores.length, 1);
    assert.equal(locadores[0]?.personName, property.ownerName);

    // Idempotente: chamar de novo não duplica a parte.
    const again = await linkOwnersAsLocador(DEMO_TENANT, contract.id);
    assert.equal(again.parties.filter((p) => p.role === "LOCADOR").length, 1);
  } finally {
    await dropContract(contract.id);
  }
});

test("um locador escolhido à mão nunca é substituído pelo dono do imóvel", async (t) => {
  const property = await propertyWithOwner();
  if (!property) return t.skip("seed sem imóvel com proprietário vinculado");

  const contract = await insertContract(
    DEMO_TENANT,
    createContractSchema.parse({ propertyId: property.id }),
  );

  try {
    // Procurador/espólio no lugar do proprietário registrado.
    const outra = await withTenant(DEMO_TENANT, async (client) => {
      const { rows } = await client.query<{ id: string; full_name: string }>(
        `SELECT id, full_name FROM persons
          WHERE id <> (SELECT person_id FROM property_owners WHERE property_id = $1 LIMIT 1)
          LIMIT 1`,
        [property.id],
      );
      return rows[0]!;
    });
    await addParty(DEMO_TENANT, contract.id, "LOCADOR", outra.id);

    const linked = await linkOwnersAsLocador(DEMO_TENANT, contract.id);
    const locadores = linked.parties.filter((p) => p.role === "LOCADOR");
    assert.equal(locadores.length, 1, "o dono do imóvel não pode ser somado à escolha manual");
    assert.equal(locadores[0]?.personName, outra.full_name);
  } finally {
    await dropContract(contract.id);
  }
});

test("contrato sem imóvel não ganha locador", async () => {
  const contract = await insertContract(DEMO_TENANT, createContractSchema.parse({}));
  try {
    const linked = await linkOwnersAsLocador(DEMO_TENANT, contract.id);
    assert.equal(linked.parties.length, 0);
  } finally {
    await dropContract(contract.id);
  }
});
