import { AppError } from "../../shared/errors.js";
import * as repo from "./bank.repository.js";
import type { Bank, CreateBankInput, UpdateBankInput } from "./bank.schema.js";

export function list(tenantId: string): Promise<Bank[]> {
  return repo.listBanks(tenantId);
}

export function create(tenantId: string, input: CreateBankInput): Promise<Bank> {
  return repo.insertBank(tenantId, input);
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateBankInput,
): Promise<Bank> {
  const updated = await repo.updateBank(tenantId, id, input);
  if (!updated) {
    throw AppError.notFound("Banco não encontrado");
  }
  return updated;
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deleteBank(tenantId, id);
  if (!removed) {
    throw AppError.notFound("Banco não encontrado");
  }
}
