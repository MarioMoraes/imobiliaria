import assert from "node:assert/strict";
import { test } from "node:test";
import { withTenant } from "../../shared/db.js";
import { insertContract } from "../contract/contract.repository.js";
import { createContractSchema } from "../contract/contract.schema.js";
import {
  generateReceivables,
  update as updateContract,
} from "../contract/contract.service.js";
import {
  cashFlowSeries,
  deleteReceivable,
  insertReceivable,
  listReceivables,
} from "./receivable.repository.js";
import { generateRentSchedule, settle } from "./receivable.service.js";

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

test("filtro por competência traz o mês pedido, inclusive a avulsa sem competência", async () => {
  const contractId = await rentedContract();
  try {
    await updateContract(DEMO_TENANT, contractId, { status: "VIGENTE" });
    // Avulsa: sem competência, o mês de referência é o do vencimento.
    await insertReceivable(DEMO_TENANT, {
      contractId,
      kind: "MULTA",
      amountCents: 5_000,
      dueDate: "2026-09-20",
    });

    const setembro = await listReceivables(DEMO_TENANT, { ...QUERY, competence: "2026-09" });
    const doContrato = setembro.filter((r) => r.contractId === contractId);
    assert.equal(doContrato.length, 2, "o aluguel de setembro e a multa vencendo em setembro");
    assert.ok(doContrato.some((r) => r.kind === "ALUGUEL" && r.competence === "2026-09"));
    assert.ok(doContrato.some((r) => r.kind === "MULTA" && r.competence === null));

    const outubro = await listReceivables(DEMO_TENANT, { ...QUERY, competence: "2026-10" });
    assert.equal(
      outubro.filter((r) => r.contractId === contractId).length,
      1,
      "outro mês não deve arrastar a parcela de setembro",
    );
  } finally {
    await dropContract(contractId);
  }
});

test("o fluxo de caixa soma o previsto pelo vencimento e o recebido pela baixa", async () => {
  const hoje = new Date().toISOString().slice(0, 10);
  const valor = 123_456;

  // O seed já tem parcelas, então o teste mede a DIFERENÇA que este lançamento
  // provoca — nunca o valor absoluto do mês.
  const mesCorrente = async (): Promise<{ received: number; expected: number }> => {
    const serie = await cashFlowSeries(DEMO_TENANT, 6);
    assert.equal(serie.length, 6, "a janela devolve um ponto por mês, sem buracos");
    const ultimo = serie.at(-1)!;
    return { received: ultimo.receivedCents, expected: ultimo.expectedCents };
  };

  const antes = await mesCorrente();
  const parcela = await insertReceivable(DEMO_TENANT, {
    kind: "OUTRO",
    description: "Teste de fluxo de caixa",
    amountCents: valor,
    dueDate: hoje,
  });

  try {
    const emAberto = await mesCorrente();
    assert.equal(emAberto.expected - antes.expected, valor, "em aberto entra no previsto");
    assert.equal(emAberto.received - antes.received, 0, "sem baixa, não é caixa");

    await settle(DEMO_TENANT, parcela.id, { paidAt: hoje });

    const paga = await mesCorrente();
    assert.equal(paga.received - antes.received, valor, "a baixa entra no recebido");
    assert.equal(paga.expected - antes.expected, valor, "e continua contando como previsto");

    const doOutro = await cashFlowSeries(OTHER_TENANT, 6);
    assert.ok(
      doOutro.every((p) => p.receivedCents === 0 && p.expectedCents === 0),
      "TENANT LEAKAGE: o agregado não pode somar parcelas de outro tenant",
    );
  } finally {
    await deleteReceivable(DEMO_TENANT, parcela.id);
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
