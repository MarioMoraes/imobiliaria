import assert from "node:assert/strict";
import { test } from "node:test";
import { decrypt, encrypt, randomSecret, secretEquals } from "./crypto.js";

/** Puro (sem infra). Cobre o que protege os tokens de terceiros em repouso. */

test("round-trip preserva o valor e nunca repete o ciphertext", () => {
  const secret = "zapsign-token-abc123";
  const a = encrypt(secret);
  const b = encrypt(secret);

  assert.equal(decrypt(a), secret);
  assert.equal(decrypt(b), secret);
  assert.notEqual(a, b, "o IV aleatório deve mudar o ciphertext a cada chamada");
  assert.ok(!a.includes(secret), "o segredo não pode aparecer em claro");
});

test("valor adulterado é rejeitado (GCM é autenticado)", () => {
  const [v, iv, tag, ct] = encrypt("token-original").split(".");
  // Troca o último caractere do ciphertext.
  const flipped = ct!.slice(0, -1) + (ct!.at(-1) === "A" ? "B" : "A");
  assert.throws(() => decrypt([v, iv, tag, flipped].join(".")));
});

test("formato inválido não passa como texto claro", () => {
  assert.throws(() => decrypt("token-em-claro"));
  assert.throws(() => decrypt("v2.a.b.c"));
});

test("secretEquals compara valores e rejeita tamanhos diferentes", () => {
  const s = randomSecret();
  assert.ok(secretEquals(s, s));
  assert.ok(!secretEquals(s, s.slice(0, -1)));
  assert.ok(!secretEquals(s, randomSecret()));
});
