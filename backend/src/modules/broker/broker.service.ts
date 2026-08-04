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

/**
 * Duplicidade de corretor é só pelo CPF — é ele que identifica a pessoa.
 * Telefone e e-mail se repetem no mundo real (a linha da imobiliária, o casal
 * que trabalha junto) e não dizem nada sobre ser o mesmo corretor.
 */
async function assertCpfLivre(tenantId: string, cpf: string, exceptId?: string): Promise<void> {
  const dup = await repo.findBrokerByCpf(tenantId, cpf, exceptId);
  if (dup) {
    throw new AppError("CONFLICT", 409, "Corretor já cadastrado com este CPF", {
      existingId: dup.id,
    });
  }
}

export async function create(tenantId: string, input: CreateBrokerInput): Promise<Broker> {
  if (input.cpf) await assertCpfLivre(tenantId, input.cpf);
  return repo.insertBroker(tenantId, input);
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateBrokerInput,
): Promise<Broker> {
  if (input.cpf) await assertCpfLivre(tenantId, input.cpf, id);
  const updated = await repo.updateBroker(tenantId, id, input);
  if (!updated) throw AppError.notFound("Corretor não encontrado");
  return updated;
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deleteBroker(tenantId, id);
  if (!removed) throw AppError.notFound("Corretor não encontrado");
}
