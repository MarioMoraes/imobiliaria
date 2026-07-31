import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { withTenant } from "../../shared/db.js";

/**
 * Concessão de papéis.
 *
 * `SUPER_ADMIN` é papel de PLATAFORMA e estava no enum aceito pela rota de troca
 * de papel, sem nenhuma checagem de alvo: qualquer ADMIN de imobiliária podia
 * concedê-lo — inclusive a si mesmo. Hoje isso não dá permissão extra (a matriz
 * empata `SUPER_ADMIN` com `ADMIN`), mas era um caminho pronto de escalada para
 * o dia em que o papel ganhasse poder de plataforma. A administração da
 * plataforma passou a ter identidade própria (ver `gateway/platform-admin.hook`).
 *
 * Depende da infra de pé (`npm run infra:up`).
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("user")).id;

let app: FastifyInstance;
let userId: string;

before(async () => {
  app = await buildApp();
  userId = await withTenant(TENANT, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, full_name, status)
       VALUES ($1, $2, 'Alvo de Teste', 'active') RETURNING id`,
      [TENANT, `papel-${Date.now()}@teste.local`],
    );
    return rows[0]!.id;
  });
});

after(async () => {
  await withTenant(TENANT, (client) =>
    client.query("DELETE FROM users WHERE id = $1", [userId]),
  );
  await app.close();
});

function changeRole(id: string, role: string) {
  return app.inject({
    method: "PATCH",
    url: `/v1/users/${id}/role`,
    payload: { role },
    headers: { "x-tenant-id": TENANT, "x-dev-roles": "ADMIN" },
  });
}

test("SUPER_ADMIN não é um papel concedível pela rota de tenant", async () => {
  const res = await changeRole(userId, "SUPER_ADMIN");

  assert.equal(res.statusCode, 400, "papel de plataforma não se concede daqui");
  assert.equal(res.json().error.code, "BAD_REQUEST");
});

test("os papéis de tenant continuam concedíveis", async () => {
  for (const role of ["GESTOR", "FINANCEIRO", "CORRETOR", "ADMIN"]) {
    const res = await changeRole(userId, role);
    assert.equal(res.statusCode, 200, `${role} deve continuar funcionando`);
    assert.deepEqual(res.json().data.roles, [role]);
  }
});

test("papel inexistente é recusado", async () => {
  const res = await changeRole(userId, "DONO_DE_TUDO");
  assert.equal(res.statusCode, 400);
});
