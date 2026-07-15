import { AppError } from "../../shared/errors.js";
import * as repo from "./condominium.repository.js";
import type {
  Condominium,
  CreateCondominiumInput,
  UpdateCondominiumInput,
} from "./condominium.schema.js";

export function list(tenantId: string): Promise<Condominium[]> {
  return repo.listCondominiums(tenantId);
}

export async function getById(tenantId: string, id: string): Promise<Condominium> {
  const found = await repo.findById(tenantId, id);
  if (!found) throw AppError.notFound("Condomínio não encontrado");
  return found;
}

export async function create(
  tenantId: string,
  input: CreateCondominiumInput,
): Promise<Condominium> {
  const existing = await repo.findByName(tenantId, input.name);
  if (existing) {
    throw new AppError("CONFLICT", 409, "Condomínio já cadastrado", {
      existingId: existing.id,
    });
  }
  return repo.insertCondominium(tenantId, input);
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateCondominiumInput,
): Promise<Condominium> {
  // Renomear para um nome já usado por OUTRO condomínio é conflito.
  if (input.name) {
    const existing = await repo.findByName(tenantId, input.name);
    if (existing && existing.id !== id) {
      throw new AppError("CONFLICT", 409, "Condomínio já cadastrado", {
        existingId: existing.id,
      });
    }
  }
  const updated = await repo.updateCondominium(tenantId, id, input);
  if (!updated) throw AppError.notFound("Condomínio não encontrado");
  return updated;
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deleteCondominium(tenantId, id);
  if (!removed) throw AppError.notFound("Condomínio não encontrado");
}
