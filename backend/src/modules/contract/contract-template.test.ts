import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deleteTemplate,
  findTemplateById,
  insertTemplate,
  listTemplates,
  updateTemplate,
} from "./contract.repository.js";

/**
 * Teste de ISOLAMENTO MULTI-TENANT dos templates de contrato (SPEC 3.1 e 14) —
 * obrigatório no CI. Depende da infra de pé (`npm run infra:up`).
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

const draft = () => ({
  name: `Modelo de isolamento ${Date.now()}`,
  content: "{{locador.nome}} — {{contrato.valor}}",
  variables: ["locador.nome", "contrato.valor"],
  active: true,
});

test("um modelo criado no tenant demo não é visível por outro tenant", async () => {
  const created = await insertTemplate(DEMO_TENANT, draft());

  try {
    const visibleToDemo = await listTemplates(DEMO_TENANT, true);
    assert.ok(
      visibleToDemo.some((t) => t.id === created.id),
      "o tenant dono deve enxergar o próprio modelo",
    );

    const visibleToOther = await listTemplates(OTHER_TENANT, true);
    assert.ok(
      !visibleToOther.some((t) => t.id === created.id),
      "TENANT LEAKAGE: outro tenant não pode enxergar o modelo",
    );

    // Escrita cruzada também não pode alcançar o registro (RLS no UPDATE).
    assert.equal(await updateTemplate(OTHER_TENANT, created.id, { name: "invadido" }), null);
    assert.equal(await deleteTemplate(OTHER_TENANT, created.id), false);
    assert.equal((await findTemplateById(DEMO_TENANT, created.id))?.name, created.name);
  } finally {
    await deleteTemplate(DEMO_TENANT, created.id);
  }
});

test("modelos inativos ficam fora da listagem padrão", async () => {
  const created = await insertTemplate(DEMO_TENANT, { ...draft(), active: false });

  try {
    const actives = await listTemplates(DEMO_TENANT);
    assert.ok(!actives.some((t) => t.id === created.id));

    const all = await listTemplates(DEMO_TENANT, true);
    assert.ok(all.some((t) => t.id === created.id));
  } finally {
    await deleteTemplate(DEMO_TENANT, created.id);
  }
});
