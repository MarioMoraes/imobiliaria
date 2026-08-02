import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { logger } from "../../shared/logger.js";
import { htmlToPdf } from "../../shared/pdf.js";
import * as contractService from "../contract/contract.service.js";
import * as personService from "../person/person.service.js";
import * as propertyService from "../property/property.service.js";
import * as tenantService from "../tenant/tenant.service.js";
import * as repo from "./payable.repository.js";
import { buildOwnerPayouts } from "./owner-payout.js";
import { toPayoutReceiptHtml } from "./receipt.js";
import { toPayoutReportHtml } from "./report.js";
import { listPayablesQuerySchema } from "./payable.schema.js";
import type {
  CreatePayableInput,
  ListPayablesQuery,
  Payable,
  PayableSummary,
  PatchPayableInput,
  SettlePayableInput,
  UpdatePayableInput,
} from "./payable.schema.js";

/**
 * Contas a pagar (MOD-FIN) — hoje, o repasse ao proprietário.
 *
 * Direção das dependências: este módulo importa `contract` e `property` (precisa
 * da taxa de administração, do "Dia Prop" e dos donos do imóvel). O caminho de
 * volta NÃO existe — `receivable` avisa a baixa por um listener registrado no
 * bootstrap (`receivableService.onSettled`), e não importando este service.
 * Sem isso fecharia o ciclo contract → receivable → payable → contract.
 */

export function list(tenantId: string, query: ListPayablesQuery): Promise<Payable[]> {
  return repo.listPayables(tenantId, query);
}

export function summary(tenantId: string, month?: string): Promise<PayableSummary> {
  return repo.summarize(tenantId, month ?? new Date().toISOString().slice(0, 7));
}

/**
 * Relatório de repasses da competência, em PDF.
 *
 * Não é guardado no storage como o documento do contrato: relatório é efêmero e
 * derivado — versionar produziria cópias que envelhecem enquanto os lançamentos
 * mudam. Gera na hora e devolve os bytes.
 *
 * Sem limite de linhas (ao contrário da listagem da tela): um relatório que
 * corta em 200 não fecha com o total, e é justamente para conferir o total que
 * ele existe.
 */
export async function report(tenantId: string, month?: string): Promise<Buffer> {
  const dueMonth = month ?? new Date().toISOString().slice(0, 7);
  const [payables, summaryData, tenant] = await Promise.all([
    repo.listPayables(tenantId, listPayablesQuerySchema.parse({ dueMonth, limit: 500 })),
    repo.summarize(tenantId, dueMonth),
    tenantService.getById(tenantId),
  ]);

  return htmlToPdf(
    toPayoutReportHtml({
      tenantName: tenant.name,
      month: dueMonth,
      payables,
      summary: summaryData,
      generatedAt: new Date(),
    }),
  );
}

export async function getById(tenantId: string, id: string): Promise<Payable> {
  const payable = await repo.findPayable(tenantId, id);
  if (!payable) throw AppError.notFound("Conta a pagar não encontrada");
  return payable;
}

/* ------------------------------------------- Seleção de vários lançamentos */

/**
 * Carrega os lançamentos escolhidos na tela e aplica o que vale para os DOIS
 * recursos que operam em lote (recibo e PIX único): existir e ser **do mesmo
 * proprietário**.
 *
 * A regra do mesmo proprietário não é cosmética: um recibo dá quitação em nome
 * de uma pessoa, e um PIX vai para uma chave. Misturar donos produziria um
 * documento falso ou um pagamento no destinatário errado — por isso a checagem
 * é do servidor, não só do desabilitar do checkbox.
 */
async function selection(tenantId: string, ids: string[]): Promise<Payable[]> {
  const payables = await repo.listPayablesByIds(tenantId, ids);

  if (payables.length !== ids.length) {
    throw AppError.notFound("Algum dos lançamentos selecionados não existe mais.");
  }
  const donos = new Set(payables.map((p) => p.payeePersonId));
  if (donos.size > 1) {
    throw AppError.badRequest(
      "Os lançamentos selecionados são de proprietários diferentes. Selecione um proprietário por vez.",
    );
  }
  return payables;
}

/** Uso do módulo `payment` (PIX único) — mesma validação, sem duplicar a regra. */
export function selectedPayables(tenantId: string, ids: string[]): Promise<Payable[]> {
  return selection(tenantId, ids);
}

/**
 * Recibo de repasse em PDF (um ou vários lançamentos do mesmo proprietário).
 *
 * Só de repasse **PAGO**: um recibo declara "recebi", então emiti-lo antes de o
 * dinheiro sair seria um documento falso — inclusive no PIX, onde o repasse fica
 * PROCESSANDO até o banco confirmar. Depois da baixa (manual ou pelo
 * `TRANSFER_DONE`) o documento sai com data, valor e competência.
 *
 * Efêmero como o relatório: gera na hora, não versiona no storage.
 */
export async function receipt(tenantId: string, ids: string[]): Promise<Buffer> {
  const payables = await selection(tenantId, ids);

  const naoPagos = payables.filter((p) => p.status !== "PAGO");
  if (naoPagos.length) {
    throw AppError.badRequest(
      naoPagos.some((p) => p.status === "PROCESSANDO")
        ? "O PIX ainda está em processamento no banco. O recibo sai quando o pagamento for confirmado."
        : "Só é possível emitir recibo de repasse já pago.",
    );
  }

  const [tenant, payee] = await Promise.all([
    tenantService.getById(tenantId),
    personService.getById(tenantId, payables[0]!.payeePersonId),
  ]);

  return htmlToPdf(
    toPayoutReceiptHtml({
      tenantName: tenant.name,
      tenantCnpj: tenant.cnpj,
      tenantCreci: tenant.creci,
      payeeName: payee.fullName,
      payeeCpfCnpj: payee.cpfCnpj,
      payables,
      generatedAt: new Date(),
    }),
  );
}

export async function create(
  tenantId: string,
  input: CreatePayableInput,
): Promise<Payable> {
  const created = await repo.insertPayable(tenantId, input);
  await publish({
    type: "payable.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { payableId: created.id, amountCents: created.amountCents },
  });
  return created;
}

export function update(
  tenantId: string,
  id: string,
  input: UpdatePayableInput,
): Promise<Payable> {
  return patch(tenantId, id, input);
}

/** Escrita interna, incluindo ciclo de vida. A rota PATCH nunca alcança isto. */
async function patch(
  tenantId: string,
  id: string,
  input: PatchPayableInput,
): Promise<Payable> {
  const updated = await repo.updatePayable(tenantId, id, input);
  if (!updated) throw AppError.notFound("Conta a pagar não encontrada");
  return updated;
}

/**
 * Baixa do repasse (o dinheiro saiu para o proprietário).
 *
 * Ao contrário da conta a receber, aqui um valor MENOR é aceito: quem paga somos
 * nós, e pagar a menos é um fato (acerto, retenção) que o financeiro registra
 * conscientemente — não um pagamento de terceiro que a contabilidade não fecha.
 */
export async function settle(
  tenantId: string,
  id: string,
  input: SettlePayableInput,
): Promise<Payable> {
  const current = await getById(tenantId, id);
  if (current.status === "PAGO") return current;
  if (current.status === "CANCELADO") {
    throw AppError.badRequest("Repasse cancelado não pode receber baixa.");
  }

  const updated = await patch(tenantId, id, {
    status: "PAGO",
    paidAt: input.paidAt ?? new Date().toISOString().slice(0, 10),
    paidAmountCents: input.paidAmountCents ?? current.amountCents,
  });

  await publish({
    type: "payable.settled",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      payableId: id,
      payeePersonId: updated.payeePersonId,
      amountCents: updated.paidAmountCents,
    },
  });
  return updated;
}

/** Cancelamento (repasse gerado por engano, contrato distratado). */
export async function cancel(tenantId: string, id: string): Promise<Payable> {
  const current = await getById(tenantId, id);
  if (current.status === "PAGO") {
    throw AppError.badRequest("Repasse já pago não pode ser cancelado.");
  }
  if (current.status === "PROCESSANDO") {
    throw AppError.badRequest(
      "Repasse com transferência em andamento no banco. Aguarde o resultado antes de cancelar.",
    );
  }
  return patch(tenantId, id, { status: "CANCELADO" });
}

/* ------------------------------------ Transferência PIX (usado pelo MOD-PAY) */

/**
 * Vincula o repasse à transferência criada no provedor e o move para
 * PROCESSANDO. Quem cria a transferência é o módulo `payment` (que conhece o
 * Asaas); aqui só guardamos a chave e o estado.
 */
export async function attachTransfer(
  tenantId: string,
  ids: string[],
  transfer: { asaasTransferId: string; transferStatus: string },
): Promise<Payable[]> {
  const updated = await repo.attachTransfer(tenantId, ids, transfer);
  if (updated.length !== ids.length) {
    throw AppError.notFound("Conta a pagar não encontrada");
  }
  return updated;
}

export function listByTransferId(
  tenantId: string,
  asaasTransferId: string,
): Promise<Payable[]> {
  return repo.listByTransferId(tenantId, asaasTransferId);
}

/**
 * Aplica o desfecho da transferência (webhook ou sincronização manual) a
 * **todos** os repasses que ela paga — um PIX único cobre vários lançamentos do
 * mesmo proprietário, e o desfecho vale para o conjunto: ou o dinheiro saiu (e
 * todos ficam PAGO), ou o banco recusou (e todos voltam a ABERTO).
 *
 * Idempotente: repasse já baixado não republica evento nem reescreve a data.
 * `effectiveDate` do Asaas é o dia em que o dinheiro caiu na conta do
 * proprietário — é essa a data do caixa, não a do clique.
 */
export async function applyTransferResult(
  tenantId: string,
  asaasTransferId: string,
  result: { status: string; effectiveDate?: string | null; failReason?: string | null },
): Promise<Payable[]> {
  const payables = await repo.listByTransferId(tenantId, asaasTransferId);
  const applied: Payable[] = [];

  for (const payable of payables) {
    if (result.status === "DONE") {
      if (payable.status === "PAGO") {
        applied.push(payable);
        continue;
      }
      const updated = await patch(tenantId, payable.id, {
        status: "PAGO",
        paidAt: result.effectiveDate ?? new Date().toISOString().slice(0, 10),
        paidAmountCents: payable.amountCents,
        transferStatus: result.status,
        transferFailedReason: null,
      });
      await publish({
        type: "payable.settled",
        tenantId,
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        payload: {
          payableId: payable.id,
          payeePersonId: payable.payeePersonId,
          amountCents: updated.paidAmountCents,
          via: "PIX",
        },
      });
      applied.push(updated);
      continue;
    }

    if (result.status === "FAILED" || result.status === "CANCELLED") {
      // Volta para ABERTO: o dinheiro não saiu, então o repasse continua devido.
      // O motivo fica gravado para o operador corrigir a chave e reenviar.
      applied.push(
        await patch(tenantId, payable.id, {
          status: "ABERTO",
          transferStatus: result.status,
          transferFailedReason: result.failReason ?? "Transferência recusada pelo banco.",
        }),
      );
      continue;
    }

    // PENDING / BANK_PROCESSING: ainda em trânsito, só atualiza o estado bruto.
    applied.push(await patch(tenantId, payable.id, { transferStatus: result.status }));
  }

  return applied;
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deletePayable(tenantId, id);
  if (!removed) throw AppError.notFound("Conta a pagar não encontrada");
}

/* ------------------------------------- Repasse a partir do aluguel pago */

/**
 * O que precisamos de uma parcela baixada. Tipo estrutural (e não o `Receivable`
 * do outro módulo) para o acoplamento ficar no formato, não no import.
 */
export interface SettledRent {
  id: string;
  kind: string;
  contractId: string | null;
  propertyId: string | null;
  competence: string | null;
  amountCents: number;
  paidAt: string | null;
}

/**
 * Reage à baixa de um aluguel: apura a taxa de administração e credita o líquido
 * aos donos do imóvel. Registrado em `app.ts` como listener de
 * `receivableService.onSettled`, então cobre de uma vez os dois caminhos de
 * baixa — a manual (`POST /receivables/:id/settle`) e a do webhook do Asaas.
 *
 * **Nunca lança.** A baixa do aluguel já foi confirmada quando isto roda; um erro
 * aqui (imóvel sem dono, contrato removido, banco instável) não pode desfazê-la
 * nem devolver 500 para quem só quis registrar um pagamento. O que falhar fica no
 * log e é recuperado depois por `generatePending` — mesma postura de
 * `contract.service.activate()` com a geração das parcelas.
 */
export async function handleRentSettled(
  tenantId: string,
  receivable: SettledRent,
): Promise<void> {
  if (receivable.kind !== "ALUGUEL") return;
  if (!receivable.contractId || !receivable.propertyId) return;

  try {
    const created = await generateForRent(tenantId, {
      receivableId: receivable.id,
      contractId: receivable.contractId,
      propertyId: receivable.propertyId,
      competence: receivable.competence,
      amountCents: receivable.amountCents,
      paidAt: receivable.paidAt,
    });
    if (created === 0) {
      logger.warn(
        { tenantId, receivableId: receivable.id },
        "aluguel pago não gerou repasse (imóvel sem proprietário ou já gerado)",
      );
    }
  } catch (err) {
    logger.error(
      { err, tenantId, receivableId: receivable.id },
      "falha ao gerar repasse do aluguel pago (baixa mantida)",
    );
  }
}

interface RentPayoutSource {
  receivableId: string;
  contractId: string;
  propertyId: string;
  competence: string | null;
  amountCents: number;
  paidAt: string | null;
}

/**
 * Monta a origem do cálculo e grava. Idempotente pelo único
 * (receivable_id, payee_person_id): devolve 0 quando o repasse já existia.
 */
async function generateForRent(
  tenantId: string,
  rent: RentPayoutSource,
): Promise<number> {
  const [contract, property] = await Promise.all([
    contractService.getById(tenantId, rent.contractId),
    propertyService.getById(tenantId, rent.propertyId),
  ]);

  // A taxa do contrato manda; a do imóvel é o padrão do cadastro, usado quando
  // o contrato não define a sua. Sem nenhuma das duas, o dono recebe integral.
  const adminFeePercent = contract.adminFeePercent ?? property.adminFeePercent ?? 0;

  const payouts = buildOwnerPayouts({
    receivableId: rent.receivableId,
    contractId: rent.contractId,
    propertyId: rent.propertyId,
    competence: rent.competence,
    baseCents: rent.amountCents,
    paidAt: rent.paidAt,
    adminFeePercent,
    ownerPayDay: contract.ownerPayDay,
    owners: property.owners.map((owner) => ({
      personId: owner.personId,
      sharePercent: owner.sharePercent,
    })),
  });

  const created = await repo.insertOwnerPayouts(
    tenantId,
    {
      receivableId: rent.receivableId,
      contractId: rent.contractId,
      propertyId: rent.propertyId,
    },
    payouts,
  );

  if (created > 0) {
    await publish({
      type: "payable.created",
      tenantId,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {
        receivableId: rent.receivableId,
        contractId: rent.contractId,
        payouts: created,
        adminFeeCents: payouts.reduce((sum, p) => sum + p.adminFeeCents, 0),
      },
    });
  }
  return created;
}

export interface GeneratePendingResult {
  /** Aluguéis pagos que estavam sem repasse. */
  scanned: number;
  /** Lançamentos efetivamente criados. */
  created: number;
}

/**
 * Reconciliação: varre aluguéis já baixados que não têm repasse e gera.
 *
 * Serve para três buracos reais — o backfill dos aluguéis pagos antes deste
 * módulo existir, o imóvel cujo proprietário só foi cadastrado depois da baixa,
 * e a baixa em que a geração falhou (`handleRentSettled` engole o erro de
 * propósito). Idempotente: rodar de novo não duplica nada.
 */
export async function generatePending(
  tenantId: string,
  limit = 200,
): Promise<GeneratePendingResult> {
  const pending = await repo.findPaidRentsWithoutPayout(tenantId, limit);
  let created = 0;

  for (const rent of pending) {
    try {
      created += await generateForRent(tenantId, rent);
    } catch (err) {
      // Um contrato removido ou imóvel sem dono não pode interromper a varredura
      // — os demais aluguéis da fila continuam sendo processados.
      logger.warn(
        { err, tenantId, receivableId: rent.receivableId },
        "repasse pendente não pôde ser gerado",
      );
    }
  }

  return { scanned: pending.length, created };
}
