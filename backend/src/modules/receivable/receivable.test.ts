import assert from "node:assert/strict";
import { test } from "node:test";
import { withTenant } from "../../shared/db.js";
import { insertContract } from "../contract/contract.repository.js";
import { createContractSchema } from "../contract/contract.schema.js";
import {
  generateReceivables,
  update as updateContract,
} from "../contract/contract.service.js";
import { listReceivables } from "./receivable.repository.js";
import { generateRentSchedule } from "./receivable.service.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT (SPEC seções 3.1 e 14) + a regra de negócio
 * que gera os aluguéis quando o contrato entra em vigência.
 *
 * Depende do banco containerizado (`npm run infra:up`) e do seed em init.sql.
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

const QUERY = { limit: 500 } as const;

async function dropContract(id: string): Promise<void> {
  // ON DELETE CASCADE leva as parcelas junto.
  await withTenant(DEMO_TENANT, async (client) => {
    await client.query("DELETE FROM contracts WHERE id = $1", [id]);
  });
}

/** Contrato de locação completo o bastante para gerar parcelas. */
async function rentedContract(): Promise<string> {
  const contract = await insertContract(
    DEMO_TENANT,
    createContractSchema.parse({
      startsAt: "2026-08-01",
      endsAt: "2027-07-31",
      termMonths: 12,
      tenantPayDay: 10,
      rentalValueCents: 250_000,
    }),
  );
  return contract.id;
}

test("uma conta a receber de um tenant não é visível por outro", async () => {
  const contractId = await rentedContract();
  try {
    await generateRentSchedule(DEMO_TENANT, {
      contractId,
      propertyId: null,
      payerPersonId: null,
      startsAt: "2026-08-01",
      endsAt: "2027-07-31",
      termMonths: 12,
      tenantPayDay: 10,
      rentalValueCents: 250_000,
    });

    const doDono = await listReceivables(DEMO_TENANT, { ...QUERY, contractId });
    assert.equal(doDono.length, 12, "o tenant dono deve enxergar as próprias parcelas");

    const doOutro = await listReceivables(OTHER_TENANT, { ...QUERY, contractId });
    assert.equal(doOutro.length, 0, "TENANT LEAKAGE: outro tenant não pode ver as parcelas");
  } finally {
    await dropContract(contractId);
  }
});

test("contrato que passa a VIGENTE gera os aluguéis do período", async () => {
  const contractId = await rentedContract();
  try {
    await updateContract(DEMO_TENANT, contractId, { status: "VIGENTE" });

    const parcelas = await listReceivables(DEMO_TENANT, { ...QUERY, contractId });
    assert.equal(parcelas.length, 12);
    assert.ok(parcelas.every((p) => p.kind === "ALUGUEL" && p.status === "ABERTO"));
    assert.ok(parcelas.every((p) => p.amountCents === 250_000));
    assert.equal(parcelas[0]?.dueDate, "2026-08-10");
    assert.equal(parcelas[0]?.installmentsTotal, 12);
  } finally {
    await dropContract(contractId);
  }
});

test("reprocessar a assinatura não duplica as parcelas", async () => {
  const contractId = await rentedContract();
  try {
    await updateContract(DEMO_TENANT, contractId, { status: "VIGENTE" });
    // Webhook reentregue / regeração manual: passa de novo pela geração.
    const { created } = await generateReceivables(DEMO_TENANT, contractId);
    assert.equal(created, 0, "nenhuma parcela nova na segunda passagem");

    const parcelas = await listReceivables(DEMO_TENANT, { ...QUERY, contractId });
    assert.equal(parcelas.length, 12, "uma parcela por mês, sem duplicar");
  } finally {
    await dropContract(contractId);
  }
});

test("o imóvel do contrato vira ALUGADO e volta a DISPONÍVEL no encerramento", async (t) => {
  const propertyId = await withTenant(DEMO_TENANT, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM properties ORDER BY created_at LIMIT 1",
    );
    return rows[0]?.id ?? null;
  });
  if (!propertyId) return t.skip("seed sem imóveis");

  const statusDoImovel = (): Promise<string> =>
    withTenant(DEMO_TENANT, async (client) => {
      const { rows } = await client.query<{ status: string }>(
        "SELECT status FROM properties WHERE id = $1",
        [propertyId],
      );
      return rows[0]!.status;
    });

  const original = await statusDoImovel();
  const contract = await insertContract(
    DEMO_TENANT,
    createContractSchema.parse({
      propertyId,
      startsAt: "2026-08-01",
      termMonths: 6,
      tenantPayDay: 10,
      rentalValueCents: 150_000,
    }),
  );

  try {
    await updateContract(DEMO_TENANT, contract.id, { status: "VIGENTE" });
    assert.equal(await statusDoImovel(), "rented");

    await updateContract(DEMO_TENANT, contract.id, { status: "ENCERRADO" });
    assert.equal(await statusDoImovel(), "available");

    const parcelas = await listReceivables(DEMO_TENANT, { ...QUERY, contractId: contract.id });
    assert.ok(
      parcelas.every((p) => p.status === "CANCELADO"),
      "encerrar o contrato cancela as parcelas em aberto",
    );
  } finally {
    await dropContract(contract.id);
    await withTenant(DEMO_TENANT, async (client) => {
      await client.query("UPDATE properties SET status = $2 WHERE id = $1", [propertyId, original]);
    });
  }
});
