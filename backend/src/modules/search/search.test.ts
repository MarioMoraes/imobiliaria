import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { withTenant } from "../../shared/db.js";

/**
 * Busca global — autorização POR DOMÍNIO.
 *
 * A busca cruza imóveis, pessoas e contratos numa resposta só, e antes era
 * gateada por uma permissão única (`property:read`, o menor denominador). O
 * efeito era um bypass do RBAC: `AI_AGENT` e `FINANCEIRO` têm `property:read`
 * mas NÃO `person:read`, e recebiam pela barra de busca o nome, o **CPF/CNPJ** e
 * o telefone de qualquer pessoa da base — dado pessoal que a matriz nega a eles.
 *
 * Depende da infra de pé (`npm run infra:up`).
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";

/** Termo improvável de casar com dado de desenvolvimento pré-existente. */
const TERM = `Zqxbusca${Date.now()}`;
/**
 * Documento único por execução: `persons` tem índice único em (tenant_id, doc) e
 * um valor fixo colidiria com o que execuções anteriores deixaram no banco de
 * desenvolvimento. Não precisa ser um CPF válido — a inserção é via SQL, e o que
 * o teste observa é se esse número aparece (ou não) na resposta da busca.
 */
const CPF = String(Date.now()).slice(-11);

let app: FastifyInstance;
let personId: string;

before(async () => {
  app = await buildApp();
  personId = await withTenant(DEMO_TENANT, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO persons (tenant_id, full_name, cpf_cnpj, roles)
       VALUES ($1, $2, $3, ARRAY['LOCATARIO']) RETURNING id`,
      [DEMO_TENANT, `${TERM} da Silva`, CPF],
    );
    return rows[0]!.id;
  });
});

after(async () => {
  await withTenant(DEMO_TENANT, (client) =>
    client.query("DELETE FROM persons WHERE id = $1", [personId]),
  );
  await app.close();
});

function search(roles: string) {
  return app.inject({
    method: "GET",
    url: `/v1/search?q=${encodeURIComponent(TERM)}`,
    headers: { "x-tenant-id": DEMO_TENANT, "x-dev-roles": roles },
  });
}

test("quem tem person:read encontra a pessoa", async () => {
  const res = await search("ADMIN");

  assert.equal(res.statusCode, 200);
  const { pessoas } = res.json().data;
  assert.equal(pessoas.length, 1, "o ADMIN deve encontrar a pessoa criada");
  assert.ok(pessoas[0].sub.includes(CPF), "e o CPF aparece de fato no resultado");
});

test("AI_AGENT não recebe pessoas na busca (não tem person:read)", async () => {
  const res = await search("AI_AGENT");

  assert.equal(res.statusCode, 200, "o papel ainda pode buscar imóveis");
  const body = res.json();
  assert.deepEqual(body.data.pessoas, [], "bucket de pessoas deve vir vazio");
  assert.ok(
    !JSON.stringify(body).includes(CPF),
    "VAZAMENTO DE DADO PESSOAL: o CPF não pode aparecer para quem não tem person:read",
  );
});

test("FINANCEIRO não recebe pessoas na busca", async () => {
  const res = await search("FINANCEIRO");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().data.pessoas, []);
});

test("AI_AGENT não recebe contratos na busca (não tem contract:read)", async () => {
  const res = await search("AI_AGENT");
  assert.deepEqual(res.json().data.contratos, []);
});

test("papel sem nenhuma das três permissões é recusado na porta", async () => {
  const res = await search("CLIENTE");
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, "ERR_AUTH_003");
});
