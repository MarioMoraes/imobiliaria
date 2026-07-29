import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeDataUrl, isExpired } from "./file.js";
import { MAX_FILE_BYTES } from "./document.schema.js";

/** Regras puras do arquivo — não precisam de banco nem de bucket. */

const dataUrl = (mime: string, bytes: Buffer): string =>
  `data:${mime};base64,${bytes.toString("base64")}`;

test("PDF e imagem passam, com a extensão certa na chave do objeto", () => {
  const pdf = decodeDataUrl(dataUrl("application/pdf", Buffer.from("%PDF-1.4")));
  assert.equal(pdf.mime, "application/pdf");
  assert.equal(pdf.ext, "pdf");

  // jpeg vira "jpg" para a chave não ficar com duas grafias do mesmo formato.
  const jpg = decodeDataUrl(dataUrl("image/jpeg", Buffer.from([0xff, 0xd8, 0xff])));
  assert.equal(jpg.ext, "jpg");
});

test("formato fora da allowlist é recusado", () => {
  assert.throws(
    () => decodeDataUrl(dataUrl("application/x-msdownload", Buffer.from("MZ"))),
    /Formato não aceito/,
  );
});

test("arquivo acima do limite é recusado depois de decodificar", () => {
  // O tamanho real só se conhece após o base64 — é por isso que a checagem vive
  // aqui, e não só no zod.
  const big = Buffer.alloc(MAX_FILE_BYTES + 1, 0x41);
  assert.throws(() => decodeDataUrl(dataUrl("application/pdf", big)), /acima do limite/);
});

test("arquivo vazio é recusado", () => {
  assert.throws(
    () => decodeDataUrl("data:application/pdf;base64,===="),
    /Arquivo vazio/,
  );
});

test("expirado é derivado da data, e sem validade nunca expira", () => {
  assert.equal(isExpired("2026-07-28", "2026-07-29"), true);
  assert.equal(isExpired("2026-07-29", "2026-07-29"), false, "vence no fim do dia");
  assert.equal(isExpired("2026-08-01", "2026-07-29"), false);
  assert.equal(isExpired(null, "2026-07-29"), false);
});
