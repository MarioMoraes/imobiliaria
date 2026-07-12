import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNotSuperuser } from "./db.js";

/**
 * MOD-AUTH-01/AC-03 (RN-01): gate de CI que falha o build se o backend estiver
 * conectando como superusuário — nesse caso o RLS é ignorado e dados vazam
 * entre tenants. Requer o banco containerizado (`npm run infra:up`).
 */
test("a conexão do backend NÃO é superusuário (RLS efetivo)", async () => {
  await assert.doesNotReject(() => assertNotSuperuser());
});
