import assert from "node:assert/strict";
import { test } from "node:test";
import { can, rolesFor } from "./permissions.js";

/** Testes unitários da matriz canônica (MOD-AUTH-03). Não dependem de infra. */

test("GESTOR pode escrever imóvel; CORRETOR pode; FINANCEIRO não", () => {
  assert.equal(can(["GESTOR"], "property:write"), true);
  assert.equal(can(["CORRETOR"], "property:write"), true);
  assert.equal(can(["FINANCEIRO"], "property:write"), false);
});

test("apenas SUPER_ADMIN/ADMIN deletam imóvel", () => {
  assert.deepEqual([...rolesFor("property:delete")], ["SUPER_ADMIN", "ADMIN"]);
  assert.equal(can(["GESTOR"], "property:delete"), false);
  assert.equal(can(["ADMIN"], "property:delete"), true);
});

test("contrato: CORRETOR escreve; FINANCEIRO só lê; delete só ADMIN", () => {
  assert.equal(can(["CORRETOR"], "contract:write"), true);
  assert.equal(can(["FINANCEIRO"], "contract:write"), false);
  assert.equal(can(["FINANCEIRO"], "contract:read"), true);
  assert.deepEqual([...rolesFor("contract:delete")], ["SUPER_ADMIN", "ADMIN"]);
  assert.equal(can(["GESTOR"], "contract:delete"), false);
});

test("gestão de usuários é restrita a SUPER_ADMIN/ADMIN", () => {
  assert.equal(can(["GESTOR"], "users:manage"), false);
  assert.equal(can(["ADMIN"], "users:manage"), true);
  assert.equal(can(["GESTOR"], "users:read"), true); // leitura permitida ao gestor
});

test("múltiplos papéis: basta um autorizar", () => {
  assert.equal(can(["CORRETOR", "FINANCEIRO"], "finance:read"), true);
});

test("sem papéis nunca autoriza", () => {
  assert.equal(can([], "property:read"), false);
});
