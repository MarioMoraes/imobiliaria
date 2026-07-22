import { AppError } from "../../shared/errors.js";
import * as repo from "./broker.repository.js";
import type { Broker, CreateBrokerInput, UpdateBrokerInput } from "./broker.schema.js";

export function list(tenantId: string): Promise<Broker[]> {
  return repo.listBrokers(tenantId);
}

export async function getById(tenantId: string, id: string): Promise<Broker> {
  const found = await repo.findBrokerById(tenantId, id);
  if (!found) throw AppError.notFound("Corretor não encontrado");
  return found;
}

export function create(tenantId: string, input: CreateBrokerInput): Promise<Broker> {
  return repo.insertBroker(tenantId, input);
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateBrokerInput,
): Promise<Broker> {
  const updated = await repo.updateBroker(tenantId, id, input);
  if (!updated) throw AppError.notFound("Corretor não encontrado");
  return updated;
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deleteBroker(tenantId, id);
  if (!removed) throw AppError.notFound("Corretor não encontrado");
}
