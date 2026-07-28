import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { logger } from "../../shared/logger.js";
import * as repo from "./receivable.repository.js";
import { buildRentSchedule } from "./rent-schedule.js";
import type {
  CashFlowPoint,
  CashFlowQuery,
  CreateReceivableInput,
  ListReceivablesQuery,
  PatchReceivableInput,
  Receivable,
  SettleReceivableInput,
  UpdateReceivableInput,
} from "./receivable.schema.js";

/**
 * Contas a receber (MOD-FIN). Este módulo **não** conhece contrato: quem
 * orquestra é o contract.service, que chama `generateRentSchedule` quando o
 * contrato passa a VIGENTE. Assim a dependência fica em um sentido só.
 */

/* ------------------------------------------ Reação à baixa (inversão) */

/** Quem quer reagir a um pagamento recebido. Ver `onSettled`. */
export type SettledListener = (tenantId: string, receivable: Receivable) => Promise<void>;

const settledListeners: SettledListener[] = [];

/**
 * Registra um interessado na baixa de pagamento (hoje: o repasse ao
 * proprietário, ligado em `app.ts`).
 *
 * É inversão de dependência, não cerimônia: o repasse precisa da taxa e do "Dia
 * Prop" do contrato, então `payable` importa `contract` — que por sua vez já
 * importa este módulo. Chamar `payableService` daqui fecharia o ciclo
 * contract → receivable → payable → contract. Com o registro no bootstrap, este
 * módulo segue sem conhecer nem contrato nem repasse.
 *
 * Não usamos o evento `payment.received` para isso porque `shared/events.ts`
 * publica em best-effort: com o RabbitMQ fora do ar o evento é descartado em
 * silêncio, e o proprietário simplesmente não seria creditado.
 */
export function onSettled(listener: SettledListener): void {
  settledListeners.push(listener);
}

/** Os listeners são isolados: um que falhe não afeta os outros nem a baixa. */
async function notifySettled(tenantId: string, receivable: Receivable): Promise<void> {
  for (const listener of settledListeners) {
    try {
      await listener(tenantId, receivable);
    } catch (err) {
      logger.error({ err, receivableId: receivable.id }, "listener de baixa falhou");
    }
  }
}

export function list(
  tenantId: string,
  query: ListReceivablesQuery,
): Promise<Receivable[]> {
  return repo.listReceivables(tenantId, query);
}

/**
 * Fluxo de caixa dos últimos meses. Agregado no banco (e não somando a listagem
 * no cliente) porque a listagem tem limite: com 200 parcelas o gráfico passaria
 * a mentir silenciosamente conforme a carteira crescesse.
 */
export function cashFlow(
  tenantId: string,
  query: CashFlowQuery,
): Promise<CashFlowPoint[]> {
  return repo.cashFlowSeries(tenantId, query.months);
}

export async function getById(tenantId: string, id: string): Promise<Receivable> {
  const receivable = await repo.findReceivable(tenantId, id);
  if (!receivable) throw AppError.notFound("Conta a receber não encontrada");
  return receivable;
}

export async function create(
  tenantId: string,
  input: CreateReceivableInput,
): Promise<Receivable> {
  const created = await repo.insertReceivable(tenantId, input);
  await publish({
    type: "receivable.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { receivableId: created.id, amountCents: created.amountCents },
  });
  return created;
}

/** Edição de dados da cobrança (descrição, valor, vencimento). */
export async function update(
  tenantId: string,
  id: string,
  input: UpdateReceivableInput,
): Promise<Receivable> {
  return patch(tenantId, id, input);
}

/**
 * Escrita interna, incluindo os campos de ciclo de vida. Só o próprio módulo usa
 * (baixa, cancelamento, webhook do provedor) — a rota PATCH nunca alcança isto.
 */
async function patch(
  tenantId: string,
  id: string,
  input: PatchReceivableInput,
): Promise<Receivable> {
  const updated = await repo.updateReceivable(tenantId, id, input);
  if (!updated) throw AppError.notFound("Conta a receber não encontrada");
  return updated;
}

/**
 * Baixa manual do pagamento.
 *
 * Um valor menor que o da parcela NÃO quita a cobrança: antes, `settle` gravava
 * `PAGO` com qualquer valor, então 1 centavo fechava um aluguel de R$ 5.000 e a
 * parcela desaparecia dos relatórios de inadimplência. Baixa parcial não é um
 * estado que este módulo modele hoje, então recusamos explicitamente em vez de
 * registrar um pagamento que a contabilidade não fecha. Valor a mais (juros,
 * multa) é normal e continua aceito.
 */
export async function settle(
  tenantId: string,
  id: string,
  input: SettleReceivableInput,
): Promise<Receivable> {
  const current = await getById(tenantId, id);
  if (current.status === "PAGO") return current;
  if (current.status === "CANCELADO") {
    throw AppError.badRequest("Conta cancelada não pode receber baixa.");
  }

  const paidAmountCents = input.paidAmountCents ?? current.amountCents;
  if (paidAmountCents < current.amountCents) {
    throw new AppError(
      "ERR_FIN_002",
      400,
      "Valor recebido é menor que o da parcela. Ajuste o valor da cobrança antes de dar a baixa.",
      { amountCents: current.amountCents, paidAmountCents },
    );
  }

  const updated = await patch(tenantId, id, {
    status: "PAGO",
    paidAt: input.paidAt ?? new Date().toISOString().slice(0, 10),
    paidAmountCents,
  });

  await publish({
    type: "payment.received",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      receivableId: id,
      contractId: updated.contractId,
      amountCents: updated.paidAmountCents,
    },
  });

  // Depois do publish e fora de qualquer guarda: quem reage precisa do estado
  // já persistido. Cobre a baixa manual e a do webhook, que passam as duas aqui.
  await notifySettled(tenantId, updated);
  return updated;
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deleteReceivable(tenantId, id);
  if (!removed) throw AppError.notFound("Conta a receber não encontrada");
}

/* --------------------------------- Cobrança bancária (usado pelo MOD-FIN) */

/**
 * Vincula a parcela à cobrança emitida no provedor. Quem emite é o módulo
 * `payment` (que conhece o Asaas); aqui só guardamos as chaves e as URLs.
 */
export async function attachCharge(
  tenantId: string,
  id: string,
  charge: { asaasChargeId: string; boletoUrl: string | null; invoiceUrl: string | null },
): Promise<Receivable> {
  const updated = await repo.attachCharge(tenantId, id, charge);
  if (!updated) throw AppError.notFound("Conta a receber não encontrada");
  return updated;
}

export function findByChargeId(
  tenantId: string,
  asaasChargeId: string,
): Promise<Receivable | null> {
  return repo.findByChargeId(tenantId, asaasChargeId);
}

/**
 * Baixa vinda do provedor (webhook de pagamento). Idempotente: cobrança já
 * baixada não republica evento nem sobrescreve a data do pagamento.
 */
export async function settleByChargeId(
  tenantId: string,
  asaasChargeId: string,
  input: { paidAt?: string; paidAmountCents?: number },
): Promise<Receivable | null> {
  const receivable = await repo.findByChargeId(tenantId, asaasChargeId);
  if (!receivable) return null;
  if (receivable.status === "PAGO") return receivable;
  return settle(tenantId, receivable.id, input);
}

/** Atraso reconhecido pelo provedor — mantém o nosso status alinhado ao dele. */
export async function markOverdueByChargeId(
  tenantId: string,
  asaasChargeId: string,
): Promise<Receivable | null> {
  const receivable = await repo.findByChargeId(tenantId, asaasChargeId);
  if (!receivable || receivable.status !== "ABERTO") return receivable;
  return patch(tenantId, receivable.id, { status: "VENCIDO" });
}

/* --------------------------------------- Geração a partir do contrato */

/** O que o contract.service passa aqui — evita importar o tipo Contract. */
export interface RentScheduleSource {
  contractId: string;
  propertyId: string | null;
  payerPersonId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  termMonths: number | null;
  tenantPayDay: number | null;
  rentalValueCents: number | null;
}

/**
 * Gera os aluguéis do contrato: uma parcela por mês de vigência, no valor do
 * aluguel, vencendo no dia previsto no contrato.
 *
 * **Idempotente** (unique em contract_id+kind+competence): reprocessar o
 * webhook de assinatura não duplica parcela. Retorna quantas foram criadas —
 * 0 significa "já existiam" ou "faltam dados no contrato".
 */
export async function generateRentSchedule(
  tenantId: string,
  source: RentScheduleSource,
): Promise<number> {
  const installments = buildRentSchedule(source);
  if (installments.length === 0) {
    logger.warn(
      { tenantId, contractId: source.contractId },
      "contrato sem início/prazo/valor — nenhuma parcela de aluguel gerada",
    );
    return 0;
  }

  const created = await repo.insertRentSchedule(
    tenantId,
    {
      contractId: source.contractId,
      propertyId: source.propertyId,
      payerPersonId: source.payerPersonId,
    },
    installments,
  );

  if (created > 0) {
    await publish({
      type: "rental.cycle_generated",
      tenantId,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {
        contractId: source.contractId,
        installments: created,
        amountCents: source.rentalValueCents,
      },
    });
  }
  return created;
}

/** Rescisão/encerramento: cancela as parcelas em aberto do contrato. */
export function cancelOpenByContract(
  tenantId: string,
  contractId: string,
  fromDate?: string,
): Promise<number> {
  return repo.cancelOpenByContract(tenantId, contractId, fromDate);
}
