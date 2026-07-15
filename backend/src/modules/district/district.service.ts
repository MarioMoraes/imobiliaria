import { AppError } from "../../shared/errors.js";
import * as repo from "./district.repository.js";
import type { District, CreateDistrictInput } from "./district.schema.js";

export function list(tenantId: string): Promise<District[]> {
  return repo.listDistricts(tenantId);
}

export async function create(
  tenantId: string,
  input: CreateDistrictInput,
): Promise<District> {
  const existing = await repo.findByName(tenantId, input.name);
  if (existing) {
    throw new AppError("CONFLICT", 409, "Bairro já cadastrado", {
      existingId: existing.id,
    });
  }
  return repo.insertDistrict(tenantId, input);
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deleteDistrict(tenantId, id);
  if (!removed) {
    throw AppError.notFound("Bairro não encontrado");
  }
}
