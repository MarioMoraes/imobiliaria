import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import * as repo from "./guarantor.repository.js";
import type { CreateGuarantorInput, Guarantor } from "./guarantor.schema.js";

export function list(tenantId: string): Promise<Guarantor[]> {
  return repo.listGuarantors(tenantId);
}

export async function getById(
  tenantId: string,
  id: string,
): Promise<Guarantor> {
  const guarantor = await repo.findGuarantor(tenantId, id);
  if (!guarantor) throw AppError.notFound("Fiador não encontrado");
  return guarantor;
}

export async function create(
  tenantId: string,
  input: CreateGuarantorInput,
): Promise<Guarantor> {
  const existing = await repo.findByDoc(tenantId, input.cpfCnpj);
  if (existing) {
    throw new AppError("CONFLICT", 409, "Fiador já cadastrado neste tenant", {
      existingId: existing.id,
    });
  }

  const guarantor = await repo.insertGuarantor(tenantId, input);

  await publish({
    type: "guarantor.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { guarantorId: guarantor.id },
  });

  return guarantor;
}
