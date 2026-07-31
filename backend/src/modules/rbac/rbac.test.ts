import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { withTenant } from "../../shared/db.js";
import { createTestTenant } from "../../testing/tenants.js";
import { resolveUserAndRoles } from "./rbac.repository.js";

/**
 * MOD-AUTH-03 — resolução de papéis por usuário, sob RLS. Requer infra de pé.
 */

async function seedUser(tenantId: string, clerkId: string, role: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, clerk_external_id, email, full_name, status)
       VALUES ($1, $2, $3, 'U', 'active') RETURNING id`,
      [tenantId, clerkId, `${clerkId}@t.com`],
    );
    await client.query(
      "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)",
      [tenantId, rows[0]!.id, role],
    );
  });
}

test("resolve o usuário e seus papéis pelo id externo do Clerk", async () => {
  const tenant = await createTestTenant("RBAC");
  const clerkId = `clerk_${randomUUID().slice(0, 8)}`;
  await seedUser(tenant.id, clerkId, "GESTOR");

  const resolved = await resolveUserAndRoles(tenant.id, clerkId);
  assert.ok(resolved.userId, "deve resolver o id local do usuário");
  assert.deepEqual(resolved.roles, ["GESTOR"]);
});

test("ISOLAMENTO: papéis não vazam entre tenants", async () => {
  const tenant = await createTestTenant("RBAC-iso");
  const clerkId = `clerk_${randomUUID().slice(0, 8)}`;
  await seedUser(tenant.id, clerkId, "ADMIN");

  // Outro tenant não resolve esse usuário.
  const other = "00000000-0000-0000-0000-0000000000ff";
  const resolved = await resolveUserAndRoles(other, clerkId);
  assert.equal(resolved.userId, null);
  assert.deepEqual(resolved.roles, []);
});
