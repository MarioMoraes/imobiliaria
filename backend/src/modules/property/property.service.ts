import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import * as repo from "./property.repository.js";
import type { CreatePropertyInput, Property } from "./property.schema.js";

/**
 * Regras de negócio de imóveis. O service é a fronteira do módulo:
 * routes chamam o service, nunca o repository direto.
 */

export function list(tenantId: string): Promise<Property[]> {
  return repo.listProperties(tenantId);
}

export async function getById(tenantId: string, id: string): Promise<Property> {
  const property = await repo.findProperty(tenantId, id);
  if (!property) throw AppError.notFound("Imóvel não encontrado");
  return property;
}

export async function create(
  tenantId: string,
  input: CreatePropertyInput,
): Promise<Property> {
  const property = await repo.insertProperty(tenantId, input);

  // Evento de domínio consumido por publishing/ai-orchestrator/portal (SPEC 12).
  await publish({
    type: "property.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { propertyId: property.id },
  });

  return property;
}
