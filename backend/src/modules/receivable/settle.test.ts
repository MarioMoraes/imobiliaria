import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { withTenant } from "../../shared/db.js";
import * as repo from "./receivable.repository.js";

/**
 * Máquina de estados da conta a receber.
 *
 * Duas falhas reais deram origem a estes testes:
 *  - `settle` gravava `PAGO` com QUALQUER valor, sem comparar com o da parcela:
 *    um centavo quitava um aluguel de R$ 5.000 e a parcela saía dos relatórios
 *    de inadimplência;
 *  - `status`, `paidAt` e `paidAmountCents` estavam no schema do PATCH, então o
 *    cliente pulava as guardas do `settle` e escrevia o estado à mão.
 *
 * Depende da infra de pé (`npm run infra:up`).
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const AMOUNT = 500_000; // R$ 5.000,00

let app: FastifyInstance;
const criados: string[] = [];

before(async () => {
  app = await buildApp();
});

after(async () => {
  await withTenant(DEMO_TENANT, (client) =>
    client.query("DELETE FROM receivables WHERE id = ANY($1::uuid[])", [criados]),
  );
  await app.close();
});

async function novaParcela(): Promise<string> {
  const r = await repo.insertReceivable(DEMO_TENANT, {
    kind: "ALUGUEL",
    description: `Parcela de teste ${Date.now()}`,
    amountCents: AMOUNT,
    dueDate: "2026-08-05",
  });
  criados.push(r.id);
  return r.id;
}

function request(method: "PATCH" | "POST", url: string, payload: Record<string, unknown>) {
  return app.inject({
    method,
    url,
    payload,
    headers: { "x-tenant-id": DEMO_TENANT, "x-dev-roles": "FINANCEIRO" },
  });
}

test("baixa com valor MENOR que a parcela é recusada (não vira PAGO)", async () => {
  const id = await novaParcela();

  const res = await request("POST", `/v1/receivables/${id}/settle`, { paidAmountCents: 1 });

  assert.equal(res.statusCode, 400, "1 centavo não quita R$ 5.000");
  assert.equal(res.json().error.code, "ERR_FIN_002");

  const depois = await repo.findReceivable(DEMO_TENANT, id);
  assert.equal(depois!.status, "ABERTO", "a parcela precisa continuar cobrável");
  assert.equal(depois!.paidAmountCents, null);
});

test("baixa com o valor exato quita a parcela", async () => {
  const id = await novaParcela();

  const res = await request("POST", `/v1/receivables/${id}/settle`, { paidAmountCents: AMOUNT });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().data.status, "PAGO");
});

test("baixa sem valor informado quita o total", async () => {
  const id = await novaParcela();

  const res = await request("POST", `/v1/receivables/${id}/settle`, {});

  assert.equal(res.statusCode, 200);
  const data = res.json().data;
  assert.equal(data.status, "PAGO");
  assert.equal(data.paidAmountCents, AMOUNT);
});

test("baixa com valor MAIOR é aceita (juros/multa)", async () => {
  const id = await novaParcela();

  const res = await request("POST", `/v1/receivables/${id}/settle`, {
    paidAmountCents: AMOUNT + 5_000,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().data.paidAmountCents, AMOUNT + 5_000);
});

test("PATCH não pode gravar status nem dados de pagamento", async () => {
  const id = await novaParcela();

  for (const payload of [
    { status: "PAGO" },
    { paidAmountCents: 1 },
    { paidAt: "2026-08-05" },
    { status: "ESTORNADO", paidAmountCents: 0 },
  ]) {
    const res = await request("PATCH", `/v1/receivables/${id}`, payload);
    assert.equal(
      res.statusCode,
      400,
      `campo de ciclo de vida não pode vir no PATCH: ${JSON.stringify(payload)}`,
    );
  }

  const depois = await repo.findReceivable(DEMO_TENANT, id);
  assert.equal(depois!.status, "ABERTO", "nenhuma das tentativas pode ter mudado o estado");
});

test("PATCH continua editando os dados da cobrança", async () => {
  const id = await novaParcela();

  const res = await request("PATCH", `/v1/receivables/${id}`, {
    amountCents: 600_000,
    dueDate: "2026-09-10",
  });

  assert.equal(res.statusCode, 200);
  const data = res.json().data;
  assert.equal(data.amountCents, 600_000);
  assert.equal(data.dueDate, "2026-09-10", "a data não pode escorregar um dia (fuso)");
});

test("valor acima do teto de negócio é recusado (protege a precisão do JS)", async () => {
  const res = await request("POST", "/v1/receivables", {
    kind: "OUTRO",
    description: "Absurdo",
    amountCents: 9_000_000_000_000_000_000,
    dueDate: "2026-08-05",
  });

  assert.equal(res.statusCode, 400);
});
