import type { FastifyRequest } from "fastify";
import { resolveTenantId } from "../../shared/tenant-context.js";
import * as service from "./tenant.service.js";

/**
 * Hook onRequest (async) que faz a RESOLUÇÃO REAL do tenant: extrai o id do
 * request e garante que ele existe e está ativo antes de qualquer handler /v1.
 *
 * Registrar ANTES do `tenantContextHook` (que apenas entra no AsyncLocalStorage).
 * Se o tenant for inválido/inativo, lança e o request é abortado aqui.
 */
export async function validateTenantHook(req: FastifyRequest): Promise<void> {
  const tenantId = resolveTenantId(req);
  await service.assertActive(tenantId);
}
