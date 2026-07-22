import { AppError } from "../../shared/errors.js";
import * as repo from "./condominium.repository.js";
import type {
  Condominium,
  CondominiumExpense,
  CreateCondominiumInput,
  CreateExpenseInput,
  UpdateCondominiumInput,
  UpdateExpenseInput,
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

/* ───────────────────────── Despesas do condomínio ────────────────────────── */

export async function listExpenses(
  tenantId: string,
  condominiumId: string,
): Promise<CondominiumExpense[]> {
  // Garante que o condomínio existe no tenant (404 claro em id inválido).
  await getById(tenantId, condominiumId);
  return repo.listExpenses(tenantId, condominiumId);
}

export async function createExpense(
  tenantId: string,
  condominiumId: string,
  input: CreateExpenseInput,
): Promise<CondominiumExpense> {
  await getById(tenantId, condominiumId);
  return repo.insertExpense(tenantId, condominiumId, input);
}

export async function updateExpense(
  tenantId: string,
  condominiumId: string,
  expenseId: string,
  input: UpdateExpenseInput,
): Promise<CondominiumExpense> {
  const updated = await repo.updateExpense(tenantId, condominiumId, expenseId, input);
  if (!updated) throw AppError.notFound("Despesa não encontrada");
  return updated;
}

export async function removeExpense(
  tenantId: string,
  condominiumId: string,
  expenseId: string,
): Promise<void> {
  const removed = await repo.deleteExpense(tenantId, condominiumId, expenseId);
  if (!removed) throw AppError.notFound("Despesa não encontrada");
}
