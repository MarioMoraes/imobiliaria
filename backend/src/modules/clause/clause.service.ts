import { AppError } from "../../shared/errors.js";
import * as repo from "./clause.repository.js";
import type { Clause, CreateClauseInput } from "./clause.schema.js";

export function list(tenantId: string): Promise<Clause[]> {
  return repo.listClauses(tenantId);
}

export async function create(
  tenantId: string,
  input: CreateClauseInput,
): Promise<Clause> {
  const existing = await repo.findByName(tenantId, input.name);
  if (existing) {
    throw new AppError("CONFLICT", 409, "Cláusula já cadastrada", {
      existingId: existing.id,
    });
  }
  return repo.insertClause(tenantId, input);
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deleteClause(tenantId, id);
  if (!removed) {
    throw AppError.notFound("Cláusula não encontrada");
  }
}
