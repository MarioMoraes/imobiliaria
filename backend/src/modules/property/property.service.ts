import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import * as repo from "./property.repository.js";
import * as personService from "../person/person.service.js";
import type { CreatePropertyInput, Property, PropertyOwner } from "./property.schema.js";

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

/** Donos (proprietários) de um imóvel. */
export async function listOwners(tenantId: string, propertyId: string): Promise<PropertyOwner[]> {
  const property = await repo.findProperty(tenantId, propertyId);
  if (!property) throw AppError.notFound("Imóvel não encontrado");
  return property.owners;
}

/**
 * Vincula um dono (pessoa) ao imóvel. Valida que a pessoa existe no tenant via
 * o service público de MOD-PESSOA (nunca acessa o repository de outro módulo).
 */
export async function addOwner(
  tenantId: string,
  propertyId: string,
  personId: string,
  sharePercent: number,
): Promise<Property> {
  const property = await repo.findProperty(tenantId, propertyId);
  if (!property) throw AppError.notFound("Imóvel não encontrado");
  await personService.getById(tenantId, personId); // 404 ERR_PESSOA_001 se não existir

  const updated = await repo.addOwner(tenantId, propertyId, personId, sharePercent);
  await publish({
    type: "property.owner_linked",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { propertyId, personId, sharePercent },
  });
  return updated;
}

export async function removeOwner(
  tenantId: string,
  propertyId: string,
  personId: string,
): Promise<Property> {
  const property = await repo.findProperty(tenantId, propertyId);
  if (!property) throw AppError.notFound("Imóvel não encontrado");
  return repo.removeOwner(tenantId, propertyId, personId);
}
