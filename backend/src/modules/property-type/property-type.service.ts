import { AppError } from "../../shared/errors.js";
import * as repo from "./property-type.repository.js";
import type {
  CreatePropertyTypeInput,
  PropertyType,
} from "./property-type.schema.js";

export function list(tenantId: string): Promise<PropertyType[]> {
  return repo.listPropertyTypes(tenantId);
}

export async function create(
  tenantId: string,
  input: CreatePropertyTypeInput,
): Promise<PropertyType> {
  const existing = await repo.findByName(tenantId, input.name);
  if (existing) {
    throw new AppError("CONFLICT", 409, "Tipo de imóvel já cadastrado", {
      existingId: existing.id,
    });
  }
  return repo.insertPropertyType(tenantId, input);
}
