import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { withTenant, withPlatform } from "../shared/db.js";

/**
 * Perímetro de autenticação: o que pode ser alcançado SEM sessão válida.
 *
 * Estes testes existem por causa de falhas reais encontradas em auditoria — cada
 * um fixa uma delas, para que não voltem:
 *  - `/admin/tenants` estava registrada fora do escopo `/v1` e por isso sem hook
 *    nenhum: qualquer anônimo listava todos os tenants da plataforma e suspendia
 *    a imobiliária que quisesse;
 *  - uma falha na verificação do token era engolida em dev-mode, então um Bearer
 *    inválido somado a `x-tenant-id` dava acesso a qualquer tenant;
 *  - `tenant_id` malformado ia direto para o `set_config` e só estourava no cast
 *    `::uuid` da policy, virando 500.
 *
 * Depende da infra de pé (`npm run infra:up`). A suíte roda com
 * AUTH_DEV_MODE=true (ver o script `test`), que é justamente o cenário mais
 * permissivo — se o perímetro se sustenta aqui, se sustenta em produção.
 */
import { createTestTenant } from "../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("auth-perimeter")).id;
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";

let app: FastifyInstance;

before(async () => {
  app = await buildApp();
});

after(async () => {
  await app.close();
});

/* ------------------------------------------- Administração da plataforma */

test("/admin/tenants recusa quem não manda token", async () => {
  const res = await app.inject({ method: "GET", url: "/admin/tenants" });

  assert.equal(res.statusCode, 401, "sem Authorization não se administra a plataforma");
  assert.equal(res.json().error.code, "UNAUTHORIZED");
});

test("/admin/tenants NÃO é alcançável pelos headers de dev-mode", async () => {
  // Este é o buraco original: os headers de dev valem para o escopo /v1, e
  // `/admin/*` ficava fora de qualquer hook. Um ADMIN de tenant (ou qualquer um,
  // já que o header é livre) não pode virar administrador da plataforma.
  for (const url of ["/admin/tenants", "/admin/tenants/" + TENANT]) {
    const res = await app.inject({
      method: "GET",
      url,
      headers: { "x-tenant-id": TENANT, "x-dev-roles": "ADMIN,SUPER_ADMIN" },
    });
    assert.equal(res.statusCode, 401, `${url} não pode aceitar headers de dev`);
  }
});

test("/admin/tenants recusa mutação anônima (não dá para suspender um tenant)", async () => {
  const res = await app.inject({
    method: "PATCH",
    url: `/admin/tenants/${TENANT}`,
    payload: { status: "suspended" },
  });

  assert.equal(res.statusCode, 401);

  // E o tenant continua operando — a mutação não passou.
  const tenant = await withPlatform(async (client) => {
    const { rows } = await client.query<{ status: string }>(
      "SELECT status FROM tenants WHERE id = $1",
      [TENANT],
    );
    return rows[0];
  });
  assert.notEqual(tenant?.status, "suspended", "o tenant não pode ter sido suspenso");
});

test("/admin/tenants recusa token inválido", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/admin/tenants",
    headers: { authorization: "Bearer nao-e-um-token" },
  });

  assert.equal(res.statusCode, 401);
});

/* --------------------------------------- Resolução de identidade em /v1 */

test("Bearer inválido NÃO cai no fallback de header (nem em dev-mode)", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/v1/properties",
    headers: {
      authorization: "Bearer token-invalido-ou-expirado",
      "x-tenant-id": OTHER_TENANT,
      "x-dev-roles": "ADMIN",
    },
  });

  assert.equal(
    res.statusCode,
    401,
    "quem manda Authorization é julgado pelo token — o header não pode socorrer",
  );
});

test("x-tenant-id que não é UUID dá 401, não 500", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/v1/properties",
    headers: { "x-tenant-id": "não-é-uuid", "x-dev-roles": "ADMIN" },
  });

  assert.equal(res.statusCode, 401, "erro do pedido, não erro do servidor");
});

test("webhook com tenant malformado responde 401 (igual a token errado), não 500", async () => {
  for (const url of ["/webhooks/asaas/xxx", "/webhooks/zapsign/xxx"]) {
    const res = await app.inject({
      method: "POST",
      url,
      payload: { event: "PAYMENT_RECEIVED", payment: { id: "pay_1" }, token: "t" },
    });
    assert.equal(res.statusCode, 401, `${url} deve tratar como credencial inválida`);
  }
});

test("sem identidade nenhuma, /v1 recusa", async () => {
  const res = await app.inject({ method: "GET", url: "/v1/properties" });
  assert.equal(res.statusCode, 401);
});

/* ------------------------------------------------- RLS da tabela tenants */

test("ISOLAMENTO: sob o contexto de um tenant, `tenants` só devolve a própria linha", async () => {
  const rows = await withTenant(TENANT, async (client) => {
    const { rows } = await client.query<{ id: string }>("SELECT id FROM tenants");
    return rows;
  });

  assert.equal(rows.length, 1, "a policy deve limitar a leitura a uma linha");
  assert.equal(
    rows[0]!.id,
    TENANT,
    "TENANT LEAKAGE: o registro de outra imobiliária ficou visível",
  );
});

test("o escopo de plataforma enxerga além de um tenant (e é explícito no código)", async () => {
  const total = await withPlatform(async (client) => {
    const { rows } = await client.query<{ n: string }>("SELECT count(*) AS n FROM tenants");
    return Number(rows[0]!.n);
  });

  assert.ok(total > 1, "withPlatform existe justamente para atravessar tenants");
});
