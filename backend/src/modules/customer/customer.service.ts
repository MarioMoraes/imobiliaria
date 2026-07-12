import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import * as repo from "./customer.repository.js";
import type {
  AddInteractionInput,
  CreateCustomerInput,
  Customer,
  SearchProfileInput,
  UpdateCustomerInput,
} from "./customer.schema.js";

/**
 * Regras de negócio de Clientes (MOD-CLIENTE). Deduplicação não-destrutiva na
 * criação (RN-01) e proteção da máquina de estados: INQUILINO/COMPRADOR só via
 * contrato assinado (RN-05), nunca manualmente.
 */

const ERR_NOT_FOUND = new AppError("ERR_CLIENTE_001", 404, "Cliente não encontrado");

/** Transições de stage permitidas manualmente (via PATCH). */
const MANUAL_STAGES = new Set(["LEAD", "CLIENTE", "INATIVO"]);

export function list(
  tenantId: string,
  filters: { stage?: string; brokerId?: string },
): Promise<Customer[]> {
  return repo.listCustomers(tenantId, filters);
}

export async function getById(tenantId: string, id: string): Promise<Customer> {
  const customer = await repo.findCustomer(tenantId, id);
  if (!customer) throw ERR_NOT_FOUND;
  return customer;
}

export async function create(
  tenantId: string,
  input: CreateCustomerInput,
): Promise<Customer> {
  if (!input.email && !input.phone) {
    throw new AppError("ERR_CLIENTE_002", 422, "Ao menos um contato (email ou telefone) é obrigatório");
  }

  // Deduplicação (MOD-CLIENTE-04): não cria pessoa duplicada.
  const dup = await repo.findDuplicate(tenantId, {
    cpf: input.cpf,
    phone: input.phone,
    email: input.email,
  });
  if (dup) {
    throw new AppError("ERR_CLIENTE_004", 409, "Cliente já cadastrado (CPF/telefone/email)", {
      existingId: dup.id,
    });
  }

  const customer = await repo.insertCustomer(tenantId, input);

  await publish({
    type: "customer.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { customerId: customer.id, stage: customer.stage, source: customer.source },
  });

  return customer;
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateCustomerInput,
): Promise<Customer> {
  const current = await repo.findCustomer(tenantId, id);
  if (!current) throw ERR_NOT_FOUND;

  if (input.stage && input.stage !== current.stage && !MANUAL_STAGES.has(input.stage)) {
    throw new AppError(
      "ERR_CLIENTE_002",
      422,
      "Transição para INQUILINO/COMPRADOR só ocorre via contrato assinado (RN-05)",
    );
  }

  const updated = await repo.updateCustomer(tenantId, id, input);

  if (input.stage && input.stage !== current.stage) {
    await publish({
      type: "customer.stage_changed",
      tenantId,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { customerId: id, from: current.stage, to: input.stage },
    });
  }

  return updated;
}

export async function addSearchProfile(
  tenantId: string,
  id: string,
  input: SearchProfileInput,
): Promise<Customer> {
  const exists = await repo.findCustomer(tenantId, id);
  if (!exists) throw ERR_NOT_FOUND;
  return repo.insertSearchProfile(tenantId, id, input);
}

export async function addInteraction(
  tenantId: string,
  id: string,
  input: AddInteractionInput,
): Promise<Customer> {
  const exists = await repo.findCustomer(tenantId, id);
  if (!exists) throw ERR_NOT_FOUND;
  return repo.insertInteraction(tenantId, id, input);
}

/** Inativação (soft delete): marca stage=INATIVO em vez de remover a pessoa. */
export async function inactivate(tenantId: string, id: string): Promise<Customer> {
  const current = await repo.findCustomer(tenantId, id);
  if (!current) throw ERR_NOT_FOUND;
  const updated = await repo.updateCustomer(tenantId, id, { stage: "INATIVO" });
  if (current.stage !== "INATIVO") {
    await publish({
      type: "customer.stage_changed",
      tenantId,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { customerId: id, from: current.stage, to: "INATIVO" },
    });
  }
  return updated;
}
