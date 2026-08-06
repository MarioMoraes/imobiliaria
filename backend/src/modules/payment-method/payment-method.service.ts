import { AppError } from "../../shared/errors.js";
import * as repo from "./payment-method.repository.js";
import type {
  CreatePaymentMethodInput,
  PaymentMethod,
  UpdatePaymentMethodInput,
} from "./payment-method.schema.js";

export function list(tenantId: string): Promise<PaymentMethod[]> {
  return repo.listPaymentMethods(tenantId);
}

export function findById(
  tenantId: string,
  id: string,
): Promise<PaymentMethod | null> {
  return repo.findPaymentMethodById(tenantId, id);
}

export async function create(
  tenantId: string,
  input: CreatePaymentMethodInput,
): Promise<PaymentMethod> {
  const existing = await repo.findByName(tenantId, input.name);
  if (existing) {
    throw new AppError("CONFLICT", 409, "Forma de pagamento já cadastrada", {
      existingId: existing.id,
    });
  }
  return repo.insertPaymentMethod(tenantId, input);
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdatePaymentMethodInput,
): Promise<PaymentMethod> {
  const updated = await repo.updatePaymentMethod(tenantId, id, input);
  if (!updated) throw AppError.notFound("Forma de pagamento não encontrada");
  return updated;
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deletePaymentMethod(tenantId, id);
  if (!removed) throw AppError.notFound("Forma de pagamento não encontrada");
}
