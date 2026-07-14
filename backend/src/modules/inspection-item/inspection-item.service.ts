import { AppError } from "../../shared/errors.js";
import * as repo from "./inspection-item.repository.js";
import type {
  CreateInspectionItemInput,
  InspectionItem,
} from "./inspection-item.schema.js";

export function list(tenantId: string): Promise<InspectionItem[]> {
  return repo.listInspectionItems(tenantId);
}

export async function create(
  tenantId: string,
  input: CreateInspectionItemInput,
): Promise<InspectionItem> {
  const existing = await repo.findByDescription(tenantId, input.description);
  if (existing) {
    throw new AppError("CONFLICT", 409, "Item de vistoria já cadastrado", {
      existingId: existing.id,
    });
  }
  return repo.insertInspectionItem(tenantId, input);
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deleteInspectionItem(tenantId, id);
  if (!removed) {
    throw AppError.notFound("Item de vistoria não encontrado");
  }
}
