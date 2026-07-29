import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { withTenant } from "../../shared/db.js";
import * as repo from "./document.repository.js";
import * as service from "./document.service.js";

/**
 * Repositório documental. Depende da infra de pé (`npm run infra:up`) e usa o
 * tenant demo do seed. Os testes ficam na camada do repositório porque o service
 * grava no bucket — o que é I/O de rede e não pertence a um teste de unidade.
 */
const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff"; // inexistente / sem dados

/** Documento com uma versão 1 fictícia (chave de bucket falsa, ninguém lê). */
function draft(overrides: Partial<Parameters<typeof repo.insertDocument>[1]> = {}) {
  return {
    entityType: "PERSON",
    entityId: randomUUID(),
    kind: "RG",
    fileName: "rg.pdf",
    mime: "application/pdf",
    sizeBytes: 1234,
    expiresAt: null,
    storageKey: `${DEMO_TENANT}/documents/person/${randomUUID()}.pdf`,
    uploadedBy: null,
    ...overrides,
  };
}

/** Limpeza: o expurgo mantém a linha de propósito, então o teste apaga na mão. */
async function hardDelete(id: string): Promise<void> {
  await withTenant(DEMO_TENANT, async (client) => {
    await client.query("DELETE FROM documents WHERE id = $1", [id]);
  });
}

test("um documento do tenant demo não é visível por outro tenant", async () => {
  const created = await repo.insertDocument(DEMO_TENANT, draft());

  try {
    const visibleToDemo = await repo.listDocuments(DEMO_TENANT, {});
    assert.ok(
      visibleToDemo.some((d) => d.id === created.id),
      "o tenant dono deve enxergar o próprio documento",
    );

    const visibleToOther = await repo.listDocuments(OTHER_TENANT, {});
    assert.ok(
      !visibleToOther.some((d) => d.id === created.id),
      "TENANT LEAKAGE: outro tenant não pode enxergar o documento",
    );

    assert.equal(await repo.findDocument(OTHER_TENANT, created.id), null);
  } finally {
    await hardDelete(created.id);
  }
});

test("o upload nasce na versão 1, já com a chave do objeto resolvida", async () => {
  const input = draft();
  const created = await repo.insertDocument(DEMO_TENANT, input);

  try {
    assert.equal(created.currentVersion, 1);
    assert.equal(created.status, "ATIVO");
    assert.equal(created.storageKey, input.storageKey);
    assert.equal((await repo.listVersions(DEMO_TENANT, created.id)).length, 1);
  } finally {
    await hardDelete(created.id);
  }
});

test("nova versão vira a vigente e PRESERVA a anterior", async () => {
  const created = await repo.insertDocument(DEMO_TENANT, draft());

  try {
    const key2 = `${DEMO_TENANT}/documents/person/${randomUUID()}.pdf`;
    const updated = await repo.insertVersion(DEMO_TENANT, created.id, {
      fileName: "rg-atualizado.pdf",
      mime: "application/pdf",
      sizeBytes: 4321,
      expiresAt: "2027-01-31",
      storageKey: key2,
      uploadedBy: null,
    });

    assert.equal(updated?.currentVersion, 2);
    assert.equal(updated?.storageKey, key2, "a leitura passa a apontar para a v2");
    assert.equal(updated?.fileName, "rg-atualizado.pdf");
    assert.equal(updated?.expiresAt, "2027-01-31");

    // A v1 continua no histórico — é a prova do que valia antes.
    const versions = await repo.listVersions(DEMO_TENANT, created.id);
    assert.deepEqual(versions.map((v) => v.version), [2, 1]);
    assert.equal((await repo.listStorageKeys(DEMO_TENANT, created.id)).length, 2);
  } finally {
    await hardDelete(created.id);
  }
});

test("omitir a validade na nova versão mantém a que já existia", async () => {
  const created = await repo.insertDocument(DEMO_TENANT, draft({ expiresAt: "2026-12-31" }));

  try {
    const updated = await repo.insertVersion(DEMO_TENANT, created.id, {
      fileName: null,
      mime: "application/pdf",
      sizeBytes: 10,
      expiresAt: undefined, // não mexe
      storageKey: `${DEMO_TENANT}/documents/person/${randomUUID()}.pdf`,
      uploadedBy: null,
    });
    assert.equal(updated?.expiresAt, "2026-12-31");
    assert.equal(updated?.fileName, "rg.pdf", "sem nome novo, mantém o anterior");

    const cleared = await repo.insertVersion(DEMO_TENANT, created.id, {
      fileName: null,
      mime: "application/pdf",
      sizeBytes: 10,
      expiresAt: null, // limpa
      storageKey: `${DEMO_TENANT}/documents/person/${randomUUID()}.pdf`,
      uploadedBy: null,
    });
    assert.equal(cleared?.expiresAt, null);
  } finally {
    await hardDelete(created.id);
  }
});

test("expurgo mantém a linha anonimizada e some da listagem padrão", async () => {
  const created = await repo.insertDocument(DEMO_TENANT, draft());

  try {
    // As chaves precisam ser lidas ANTES do expurgo — depois dele não há mais o
    // que apagar no bucket.
    const keys = await repo.listStorageKeys(DEMO_TENANT, created.id);
    assert.equal(keys.length, 1);

    assert.equal(await repo.markPurged(DEMO_TENANT, created.id), true);
    assert.equal(
      await repo.markPurged(DEMO_TENANT, created.id),
      false,
      "expurgar de novo não faz nada",
    );

    const purged = await repo.findDocument(DEMO_TENANT, created.id);
    assert.equal(purged?.status, "EXPURGADO");
    assert.equal(purged?.fileName, null, "metadado anonimizado");
    assert.equal(purged?.mime, null);
    assert.equal(purged?.storageKey, null, "sem chave, ninguém presigna nada");

    const listed = await repo.listDocuments(DEMO_TENANT, {});
    assert.ok(!listed.some((d) => d.id === created.id));

    // Mas continua acessível para auditoria.
    const audited = await repo.listDocuments(DEMO_TENANT, { includePurged: true });
    assert.ok(audited.some((d) => d.id === created.id));

    // Expurgado não aceita versão nova.
    const rejected = await repo.insertVersion(DEMO_TENANT, created.id, {
      fileName: null,
      mime: "application/pdf",
      sizeBytes: 1,
      expiresAt: undefined,
      storageKey: "x",
      uploadedBy: null,
    });
    assert.equal(rejected, null);
  } finally {
    await hardDelete(created.id);
  }
});

test("filtro por entidade só devolve o que está preso àquela entidade", async () => {
  const entityId = randomUUID();
  const mine = await repo.insertDocument(DEMO_TENANT, draft({ entityId, kind: "RENDA" }));
  const other = await repo.insertDocument(DEMO_TENANT, draft());

  try {
    const found = await repo.listDocuments(DEMO_TENANT, { entityType: "PERSON", entityId });
    assert.deepEqual(found.map((d) => d.id), [mine.id]);

    const byKind = await repo.listDocuments(DEMO_TENANT, { entityId, kind: "RG" });
    assert.equal(byKind.length, 0, "o kind do documento é RENDA");
  } finally {
    await hardDelete(mine.id);
    await hardDelete(other.id);
  }
});

test("anexar a uma entidade inexistente falha antes de tocar no bucket", async () => {
  await assert.rejects(
    service.create(DEMO_TENANT, {
      entityType: "PROPERTY",
      entityId: randomUUID(),
      kind: "MATRICULA",
      fileName: "matricula.pdf",
      dataUrl: `data:application/pdf;base64,${Buffer.from("%PDF-1.4").toString("base64")}`,
    }),
    /não encontrado/i,
  );
});
