import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import * as repo from "./person.repository.js";
import type {
  AddInteractionInput,
  CreatePersonInput,
  Person,
  PersonAddressInput,
  SearchProfileInput,
  UpdatePersonInput,
} from "./person.schema.js";

/**
 * Regras de negócio de Pessoas (MOD-PESSOA). Deduplicação não-destrutiva na
 * criação (RN-01) e proteção da máquina de estados: INQUILINO/COMPRADOR só via
 * contrato assinado (RN-05), nunca manualmente.
 */

const ERR_NOT_FOUND = new AppError("ERR_PESSOA_001", 404, "Pessoa não encontrada");

/** Transições de stage permitidas manualmente (via PATCH). */
const MANUAL_STAGES = new Set(["LEAD", "CLIENTE", "INATIVO"]);

/** Busca livre (barra global): nome, CPF/CNPJ, e-mail ou telefone. */
export function search(tenantId: string, term: string, limit?: number): Promise<Person[]> {
  return repo.searchPersons(tenantId, term, limit);
}

export function list(
  tenantId: string,
  filters: { role?: string; stage?: string; brokerId?: string },
): Promise<Person[]> {
  return repo.listPersons(tenantId, filters);
}

export async function getById(tenantId: string, id: string): Promise<Person> {
  const person = await repo.findPerson(tenantId, id);
  if (!person) throw ERR_NOT_FOUND;
  return person;
}

export async function create(tenantId: string, input: CreatePersonInput): Promise<Person> {
  if (!input.email && !input.phone) {
    throw new AppError(
      "ERR_PESSOA_002",
      422,
      "Ao menos um contato (email ou telefone) é obrigatório",
    );
  }

  // Deduplicação (MOD-CLIENTE-04): não cria pessoa duplicada.
  const dup = await repo.findDuplicate(tenantId, {
    cpfCnpj: input.cpfCnpj,
    phone: input.phone,
    email: input.email,
  });
  if (dup) {
    throw new AppError("ERR_PESSOA_004", 409, "Pessoa já cadastrada (CPF/CNPJ/telefone/email)", {
      existingId: dup.id,
    });
  }

  const person = await repo.insertPerson(tenantId, input);

  await publish({
    type: "person.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { personId: person.id, roles: person.roles, stage: person.stage, source: person.source },
  });

  return person;
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdatePersonInput,
): Promise<Person> {
  const current = await repo.findPerson(tenantId, id);
  if (!current) throw ERR_NOT_FOUND;

  if (input.stage && input.stage !== current.stage && !MANUAL_STAGES.has(input.stage)) {
    throw new AppError(
      "ERR_PESSOA_005",
      422,
      "Transição para INQUILINO/COMPRADOR só ocorre via contrato assinado (RN-05)",
    );
  }

  const updated = await repo.updatePerson(tenantId, id, input);

  if (input.stage && input.stage !== current.stage) {
    await publish({
      type: "person.stage_changed",
      tenantId,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { personId: id, from: current.stage, to: input.stage },
    });
  }

  return updated;
}

export async function addAddress(
  tenantId: string,
  id: string,
  input: PersonAddressInput,
): Promise<Person> {
  const exists = await repo.findPerson(tenantId, id);
  if (!exists) throw ERR_NOT_FOUND;
  return repo.insertAddress(tenantId, id, input);
}

export async function addSearchProfile(
  tenantId: string,
  id: string,
  input: SearchProfileInput,
): Promise<Person> {
  const exists = await repo.findPerson(tenantId, id);
  if (!exists) throw ERR_NOT_FOUND;
  return repo.insertSearchProfile(tenantId, id, input);
}

export async function addInteraction(
  tenantId: string,
  id: string,
  input: AddInteractionInput,
): Promise<Person> {
  const exists = await repo.findPerson(tenantId, id);
  if (!exists) throw ERR_NOT_FOUND;
  return repo.insertInteraction(tenantId, id, input);
}

/**
 * Inativação (soft delete): marca stage=INATIVO e status=inactive em vez de
 * remover a pessoa — a ficha sai das listas mas o histórico (contratos,
 * interações) continua íntegro.
 */
export async function inactivate(tenantId: string, id: string): Promise<Person> {
  const current = await repo.findPerson(tenantId, id);
  if (!current) throw ERR_NOT_FOUND;
  await repo.updatePerson(tenantId, id, { stage: "INATIVO" });
  const updated = await repo.setStatus(tenantId, id, "inactive");
  if (current.stage !== "INATIVO") {
    await publish({
      type: "person.stage_changed",
      tenantId,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { personId: id, from: current.stage, to: "INATIVO" },
    });
  }
  return updated;
}
