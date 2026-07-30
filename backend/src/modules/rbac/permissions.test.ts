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

test("AUXILIAR escreve o operacional inteiro", () => {
  for (const op of [
    "property:write",
    "person:write",
    "contract:write",
    "crm:write",
    "condominium:write",
    "document:write",
  ] as const) {
    assert.equal(can(["AUXILIAR"], op), true, `AUXILIAR deveria poder ${op}`);
  }
  assert.equal(can(["AUXILIAR"], "finance:read"), true, "consulta o que está em aberto");
  assert.equal(can(["AUXILIAR"], "ai:use"), true);
});

test("AUXILIAR não apaga NADA, e não mexe em usuário, configuração nem dinheiro", () => {
  // A regra que define o papel: quem alimenta o cadastro o dia inteiro é quem
  // mais erra por pressa, e nenhum destes tem desfazer.
  for (const op of [
    "property:delete",
    "person:delete",
    "contract:delete",
    "condominium:delete",
    "broker:delete",
    "document:delete",
  ] as const) {
    assert.equal(can(["AUXILIAR"], op), false, `AUXILIAR não pode ${op}`);
  }
  assert.equal(can(["AUXILIAR"], "finance:write"), false, "baixa e repasse não são dele");
  assert.equal(can(["AUXILIAR"], "users:read"), false);
  assert.equal(can(["AUXILIAR"], "users:manage"), false);
  assert.equal(can(["AUXILIAR"], "tenant:config:read"), false);
  assert.equal(can(["AUXILIAR"], "broker:write"), false);
  assert.equal(can(["AUXILIAR"], "ai:read"), false, "histórico de conversa é auditoria");
});

test("a trilha de auditoria é de quem responde pelo tenant", () => {
  assert.equal(can(["SUPER_ADMIN"], "audit:read"), true);
  assert.equal(can(["ADMIN"], "audit:read"), true);
  for (const role of ["GESTOR", "FINANCEIRO", "CORRETOR", "AUXILIAR", "AI_AGENT"] as const) {
    assert.equal(can([role], "audit:read"), false, `${role} não lê a trilha`);
  }
});

test("múltiplos papéis: basta um autorizar", () => {
  assert.equal(can(["CORRETOR", "FINANCEIRO"], "finance:read"), true);
});

test("sem papéis nunca autoriza", () => {
  assert.equal(can([], "property:read"), false);
});
