import assert from "node:assert/strict";
import { test } from "node:test";
import * as service from "./property.service.js";
import { deleteProperty, updateProperty } from "./property.repository.js";
import { createPropertySchema } from "./property.schema.js";

/**
 * "Reservado" do cadastro → Situação do imóvel. Depende da infra de pé
 * (`npm run infra:up`).
 */
import { createTestTenant } from "../../testing/tenants.js";

// Tenant próprio deste arquivo, descartado no `after` do fixture. Usar o
// tenant demo fazia cada execução da suíte deixar linhas na imobiliária de
// desenvolvimento — apareciam no painel misturadas ao dado real.
const TENANT = (await createTestTenant("reservation")).id;

const draft = () =>
  createPropertySchema.parse({
    title: `Imóvel de teste de reserva ${Date.now()}`,
    kind: "rent",
    purpose: "rent",
  });

test("marcar Reservado deixa o imóvel reservado; desmarcar devolve a disponível", async () => {
  const created = await service.create(TENANT, { ...draft(), reserved: true });

  try {
    assert.equal(created.status, "reserved", "nasce reservado quando a marcação vem no cadastro");

    const unreserved = await service.update(TENANT, created.id, { reserved: false });
    assert.equal(unreserved.status, "available");

    const again = await service.update(TENANT, created.id, { reserved: true });
    assert.equal(again.status, "reserved");

    // Salvar o formulário sem tocar na marcação não mexe na situação.
    const renamed = await service.update(TENANT, created.id, { title: "Outro título" });
    assert.equal(renamed.status, "reserved");
  } finally {
    await deleteProperty(TENANT, created.id);
  }
});

test("imóvel ALUGADO não é afetado pela marcação (quem manda é o contrato)", async () => {
  const created = await service.create(TENANT, draft());

  try {
    // Simula o efeito da entrada em vigência do contrato.
    await updateProperty(TENANT, created.id, { status: "rented" });

    // Um cadastro aberto ANTES da assinatura salva com "Reservado" desmarcado;
    // isso não pode devolver o imóvel à vitrine — nem impedir o resto de salvar.
    const saved = await service.update(TENANT, created.id, {
      reserved: false,
      title: "Título editado com o imóvel já alugado",
    });
    assert.equal(saved.status, "rented");
    assert.equal(saved.title, "Título editado com o imóvel já alugado");

    const reserved = await service.update(TENANT, created.id, { reserved: true });
    assert.equal(reserved.status, "rented");
  } finally {
    await deleteProperty(TENANT, created.id);
  }
});
