import { AppError } from "../../shared/errors.js";
import * as repo from "./event.repository.js";
import type { Event, CreateEventInput } from "./event.schema.js";

export function list(tenantId: string): Promise<Event[]> {
  return repo.listEvents(tenantId);
}

export async function create(
  tenantId: string,
  input: CreateEventInput,
): Promise<Event> {
  const existing = await repo.findByName(tenantId, input.name);
  if (existing) {
    throw new AppError("CONFLICT", 409, "Evento já cadastrado", {
      existingId: existing.id,
    });
  }
  return repo.insertEvent(tenantId, input);
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deleteEvent(tenantId, id);
  if (!removed) {
    throw AppError.notFound("Evento não encontrado");
  }
}
