import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import * as repo from "./cashflow.repository.js";
import * as entriesRepo from "./entries.repository.js";
import type {
  CashFlowCategory,
  CashFlowEntry,
  CashFlowMovement,
  CashFlowSeriesPoint,
  CashFlowStatement,
  CashFlowSummary,
  CreateCashFlowCategoryInput,
  CreateCashFlowEntryInput,
  ListCashFlowEntriesQuery,
  UpdateCashFlowCategoryInput,
  UpdateCashFlowEntryInput,
} from "./cashflow.schema.js";

/**
 * Fluxo de caixa (MOD-FIN).
 *
 * Duas responsabilidades bem separadas: consolidar o extrato (leitura pura,
 * derivada — ver `cashflow.repository.ts`) e manter as duas tabelas próprias
 * (categoria e lançamento manual).
 *
 * Os totais são somados AQUI, sobre os movimentos que o banco já filtrou, e não
 * numa segunda consulta agregada: dois SQLs para o mesmo mês inevitavelmente
 * divergem quando um deles é ajustado sozinho, e é exatamente o número do
 * rodapé que ninguém confere.
 */

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/* --------------------------------------------------------- Extrato do mês */

export async function statement(
  tenantId: string,
  month?: string,
): Promise<CashFlowStatement> {
  const ref = month ?? currentMonth();
  const { movements, pendingPayoutCents } = await repo.statementData(tenantId, ref);

  return {
    month: ref,
    movements,
    summary: summarize(ref, movements, pendingPayoutCents),
    byCategory: repo.groupByCategory(movements),
  };
}

/**
 * Os dois totais e a quebra do resultado.
 *
 * `cash` é o extrato do banco (dinheiro de terceiros incluído) e `result` é o
 * que fica com a imobiliária. Um movimento pode entrar em nenhum, num ou nos
 * dois — quem decide é a própria linha, pelas flags. Ver o cabeçalho de
 * `cashflow.schema.ts` para o porquê de a taxa de administração ficar fora do
 * caixa.
 */
function summarize(
  month: string,
  movements: CashFlowMovement[],
  pendingPayoutCents: number,
): CashFlowSummary {
  const summary: CashFlowSummary = {
    month,
    cash: { inflowCents: 0, outflowCents: 0, netCents: 0 },
    result: { inflowCents: 0, outflowCents: 0, netCents: 0 },
    adminFeeCents: 0,
    lateFeeCents: 0,
    commissionEarnedCents: 0,
    commissionPaidCents: 0,
    manualIncomeCents: 0,
    manualExpenseCents: 0,
    pendingPayoutCents,
  };

  for (const m of movements) {
    const inflow = m.direction === "ENTRADA";

    if (m.affectsCash) {
      if (inflow) summary.cash.inflowCents += m.amountCents;
      else summary.cash.outflowCents += m.amountCents;
    }
    if (m.affectsResult) {
      if (inflow) summary.result.inflowCents += m.amountCents;
      else summary.result.outflowCents += m.amountCents;
    }

    switch (m.source) {
      case "TAXA_ADM":
        summary.adminFeeCents += m.amountCents;
        break;
      case "JUROS_MULTA":
        summary.lateFeeCents += m.amountCents;
        break;
      case "COMISSAO":
        if (inflow) summary.commissionEarnedCents += m.amountCents;
        else summary.commissionPaidCents += m.amountCents;
        break;
      case "MANUAL":
        if (inflow) summary.manualIncomeCents += m.amountCents;
        else summary.manualExpenseCents += m.amountCents;
        break;
      default:
        break;
    }
  }

  summary.cash.netCents = summary.cash.inflowCents - summary.cash.outflowCents;
  summary.result.netCents = summary.result.inflowCents - summary.result.outflowCents;
  return summary;
}

export function series(tenantId: string, months: number): Promise<CashFlowSeriesPoint[]> {
  return repo.series(tenantId, months);
}

/* ------------------------------------------------------------ Categorias */

export function listCategories(tenantId: string): Promise<CashFlowCategory[]> {
  return entriesRepo.listCategories(tenantId);
}

export function createCategory(
  tenantId: string,
  input: CreateCashFlowCategoryInput,
): Promise<CashFlowCategory> {
  return entriesRepo.insertCategory(tenantId, input);
}

export async function updateCategory(
  tenantId: string,
  id: string,
  input: UpdateCashFlowCategoryInput,
): Promise<CashFlowCategory> {
  const updated = await entriesRepo.updateCategory(tenantId, id, input);
  if (!updated) throw AppError.notFound("Categoria não encontrada");
  return updated;
}

export async function removeCategory(tenantId: string, id: string): Promise<void> {
  const removed = await entriesRepo.deleteCategory(tenantId, id);
  if (!removed) throw AppError.notFound("Categoria não encontrada");
}

/* ------------------------------------------------- Lançamentos manuais */

export function listEntries(
  tenantId: string,
  query: ListCashFlowEntriesQuery,
): Promise<CashFlowEntry[]> {
  return entriesRepo.listEntries(tenantId, query);
}

export async function getEntry(tenantId: string, id: string): Promise<CashFlowEntry> {
  const entry = await entriesRepo.findEntry(tenantId, id);
  if (!entry) throw AppError.notFound("Lançamento não encontrado");
  return entry;
}

export async function createEntry(
  tenantId: string,
  input: CreateCashFlowEntryInput,
): Promise<CashFlowEntry> {
  // A categoria tem que existir no tenant: sem a checagem, um id errado gravaria
  // um lançamento que some do "resumo por categoria" sem explicação.
  if (input.categoryId) await requireCategory(tenantId, input.categoryId);

  const created = await entriesRepo.insertEntry(tenantId, input);

  await publish({
    type: "cashflow.entry.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      entryId: created.id,
      direction: created.direction,
      amountCents: created.amountCents,
    },
  });
  return created;
}

export async function updateEntry(
  tenantId: string,
  id: string,
  input: UpdateCashFlowEntryInput,
): Promise<CashFlowEntry> {
  if (input.categoryId) await requireCategory(tenantId, input.categoryId);

  const updated = await entriesRepo.updateEntry(tenantId, id, input);
  if (!updated) throw AppError.notFound("Lançamento não encontrado");
  return updated;
}

export async function removeEntry(tenantId: string, id: string): Promise<void> {
  const removed = await entriesRepo.deleteEntry(tenantId, id);
  if (!removed) throw AppError.notFound("Lançamento não encontrado");
}

async function requireCategory(tenantId: string, categoryId: string): Promise<void> {
  const category = await entriesRepo.findCategory(tenantId, categoryId);
  if (!category) throw AppError.badRequest("Categoria não encontrada");
}
