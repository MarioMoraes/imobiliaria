import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { logger } from "../../shared/logger.js";
import * as brokerService from "../broker/broker.service.js";
import { buildCommissionSplit } from "./commission-split.js";
import * as repo from "./commission.repository.js";
import type {
  Commission,
  CommissionSummary,
  CreateCommissionInput,
  ListCommissionsQuery,
  PatchCommissionInput,
  SettleCommissionInput,
  UpdateCommissionInput,
} from "./commission.schema.js";

/**
 * Comissões (MOD-FIN-05) — a da venda do imóvel e, no futuro, a da locação.
 *
 * Direção das dependências: este módulo importa `broker` (precisa do percentual
 * de comissão do corretor). Nada importa daqui de volta; o fluxo de caixa lê as
 * comissões pelo próprio SELECT agregado, sem passar por este service.
 *
 * O módulo de VENDA do imóvel ainda não existe. Quando existir, ele chama
 * `createForSale` — é o único ponto de entrada previsto, e por isso ele carrega
 * a idempotência (único por `sale_id`) em vez de deixá-la com quem chama.
 *
 * Fora desta fase: "corretor vê as próprias comissões" (PRD financeiro_11 §5).
 * Hoje o gate é `finance:read`/`finance:write` para todo mundo.
 */

export function list(
  tenantId: string,
  query: ListCommissionsQuery,
): Promise<Commission[]> {
  return repo.listCommissions(tenantId, query);
}

export function summary(tenantId: string, month?: string): Promise<CommissionSummary> {
  return repo.summarize(tenantId, month ?? new Date().toISOString().slice(0, 7));
}

export async function getById(tenantId: string, id: string): Promise<Commission> {
  const commission = await repo.findCommission(tenantId, id);
  if (!commission) throw AppError.notFound("Comissão não encontrada");
  return commission;
}

/**
 * Lançamento manual de uma parte. O valor pode vir pronto ou ser derivado de
 * base × percentual — o schema já garante que um dos dois caminhos existe.
 */
export async function create(
  tenantId: string,
  input: CreateCommissionInput,
): Promise<Commission> {
  const amountCents =
    input.amountCents ?? Math.round((input.baseCents * input.percent) / 100);

  if (amountCents <= 0) {
    throw AppError.badRequest("O valor da comissão precisa ser maior que zero.");
  }
  // O corretor tem que existir no tenant: sem esta checagem um UUID digitado
  // errado viraria uma despesa sem dono, invisível na lista do corretor.
  if (input.brokerId) await brokerService.getById(tenantId, input.brokerId);

  const created = await repo.insertCommission(tenantId, { ...input, amountCents });

  await publish({
    type: "commission.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      commissionId: created.id,
      party: created.party,
      amountCents: created.amountCents,
    },
  });
  return created;
}

export function update(
  tenantId: string,
  id: string,
  input: UpdateCommissionInput,
): Promise<Commission> {
  return patch(tenantId, id, input);
}

/** Escrita interna, incluindo ciclo de vida. A rota PATCH nunca alcança isto. */
async function patch(
  tenantId: string,
  id: string,
  input: PatchCommissionInput,
): Promise<Commission> {
  const updated = await repo.updateCommission(tenantId, id, input);
  if (!updated) throw AppError.notFound("Comissão não encontrada");
  return updated;
}

/**
 * Quitação — o dinheiro entrou (parte da imobiliária) ou saiu (parte do
 * corretor). É esta data que posiciona o movimento no fluxo de caixa, então ela
 * é a do caixa e não a do clique: quem lança pode informar o dia real.
 */
export async function settle(
  tenantId: string,
  id: string,
  input: SettleCommissionInput,
): Promise<Commission> {
  const current = await getById(tenantId, id);
  if (current.status === "QUITADO") return current;
  if (current.status === "CANCELADO") {
    throw AppError.badRequest("Comissão cancelada não pode ser quitada.");
  }

  const updated = await patch(tenantId, id, {
    status: "QUITADO",
    settledAt: input.settledAt ?? new Date().toISOString().slice(0, 10),
    settledAmountCents: input.settledAmountCents ?? current.amountCents,
  });

  await publish({
    type: "commission.settled",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      commissionId: id,
      party: updated.party,
      brokerId: updated.brokerId,
      amountCents: updated.settledAmountCents,
    },
  });
  return updated;
}

/**
 * Cancelamento. Uma comissão já quitada não volta atrás por aqui: o dinheiro se
 * moveu, e apagá-lo do caixa faria o mês fechado mudar de valor. Mesma regra do
 * repasse pago.
 */
export async function cancel(tenantId: string, id: string): Promise<Commission> {
  const current = await getById(tenantId, id);
  if (current.status === "QUITADO") {
    throw AppError.badRequest("Comissão já quitada não pode ser cancelada.");
  }
  return patch(tenantId, id, { status: "CANCELADO" });
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const current = await getById(tenantId, id);
  if (current.status === "QUITADO") {
    throw AppError.badRequest(
      "Comissão já quitada não pode ser excluída. Ela faz parte do fluxo de caixa do mês.",
    );
  }
  const removed = await repo.deleteCommission(tenantId, id);
  if (!removed) throw AppError.notFound("Comissão não encontrada");
}

/* ------------------------------------------- Comissão a partir da venda */

export interface SaleCommissionSource {
  /** Identificador da venda no módulo futuro — é a chave da idempotência. */
  saleId: string;
  propertyId: string | null;
  contractId?: string | null;
  saleValueCents: number;
  /** Comissão total cobrada do cliente, em % sobre a venda. */
  commissionPercent: number;
  /** Corretor que intermediou; sem ele a comissão inteira fica com a imobiliária. */
  brokerId?: string | null;
  dueDate: string;
  brokerDueDate?: string;
  /** Código ou título do imóvel, só para a descrição. */
  reference?: string | null;
}

/**
 * Gera o par de comissões de uma venda fechada.
 *
 * **Ponto de entrada do módulo de venda.** Ele passa a venda e nós devolvemos
 * quantas linhas nasceram — idempotente pelo único (sale_id, party, broker_id),
 * então reprocessar o fechamento devolve 0 em vez de pagar o corretor de novo.
 *
 * Ao contrário de `payable.handleRentSettled`, este caminho **lança**: aqui quem
 * chama é o fechamento da venda, uma ação síncrona do operador que deve falhar
 * visivelmente se a comissão não puder ser apurada.
 */
export async function createForSale(
  tenantId: string,
  sale: SaleCommissionSource,
): Promise<number> {
  const broker = sale.brokerId
    ? await brokerService.getById(tenantId, sale.brokerId)
    : null;

  const entries = buildCommissionSplit({
    saleValueCents: sale.saleValueCents,
    commissionPercent: sale.commissionPercent,
    broker: broker ? { id: broker.id, commissionPercent: broker.commissionPercent } : null,
    dueDate: sale.dueDate,
    brokerDueDate: sale.brokerDueDate,
    reference: sale.reference,
  });

  if (entries.length === 0) {
    logger.warn(
      { tenantId, saleId: sale.saleId },
      "venda não gerou comissão (valor ou percentual zerado)",
    );
    return 0;
  }

  const created = await repo.insertSaleCommissions(
    tenantId,
    {
      saleId: sale.saleId,
      propertyId: sale.propertyId,
      contractId: sale.contractId ?? null,
    },
    entries,
  );

  if (created > 0) {
    await publish({
      type: "commission.created",
      tenantId,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {
        saleId: sale.saleId,
        parts: created,
        totalCents: entries.reduce((sum, e) => sum + e.amountCents, 0),
      },
    });
  }
  return created;
}
