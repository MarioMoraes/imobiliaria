import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { htmlToPdf } from "../../shared/pdf.js";
import * as repo from "./condominium.repository.js";
import * as contractService from "../contract/contract.service.js";
import * as propertyService from "../property/property.service.js";
import * as receivableService from "../receivable/receivable.service.js";
import * as tenantService from "../tenant/tenant.service.js";
import { toBillingReportHtml } from "./billing-report.js";
import { buildCondoBilling, competenceOf, monthsInPeriod, type ActiveTenant } from "./condo-billing.js";
import type { CondoChargeRow, Receivable } from "../receivable/receivable.schema.js";
import type {
  Condominium,
  CondominiumExpense,
  CondoBillingPreview,
  CondoBillingQuery,
  CondoBillingResult,
  CreateCondominiumInput,
  CreateExpenseInput,
  UpdateCondominiumInput,
  UpdateExpenseInput,
} from "./condominium.schema.js";

/**
 * Saldo do condomínio: o que os condôminos PAGARAM menos o que foi lançado
 * como despesa. Pode ser negativo — é o caixa, e antes de alguém pagar o
 * condomínio está no vermelho pelas despesas do período.
 *
 * DERIVADO na leitura, e não um contador somado a cada baixa. Um contador
 * erraria em silêncio no primeiro tropeço: o Asaas reentrega o webhook até
 * receber 200, e cobrança cancelada ou estornada depois do pagamento deixaria
 * o crédito lá para sempre. Derivando, cada leitura reflete o estado real e o
 * número se conserta sozinho. É o que `init.sql` já dizia sobre `balance_cents`
 * ("Saldo (derivado)") — a coluna nunca chegou a ser escrita.
 *
 * Em lote (`ANY($1)`) porque a listagem mostra todos os condomínios: uma
 * consulta por linha seria N+1.
 */
async function withBalances(
  tenantId: string,
  condominiums: Condominium[],
): Promise<Condominium[]> {
  if (condominiums.length === 0) return condominiums;

  const ids = condominiums.map((c) => c.id);
  const [received, spent] = await Promise.all([
    receivableService.sumPaidByCondominium(tenantId, ids),
    repo.sumExpensesByCondominium(tenantId, ids),
  ]);

  return condominiums.map((c) => ({
    ...c,
    balanceCents: (received.get(c.id) ?? 0) - (spent.get(c.id) ?? 0),
  }));
}

export async function list(tenantId: string): Promise<Condominium[]> {
  return withBalances(tenantId, await repo.listCondominiums(tenantId));
}

export async function getById(tenantId: string, id: string): Promise<Condominium> {
  const found = await repo.findById(tenantId, id);
  if (!found) throw AppError.notFound("Condomínio não encontrado");
  const [withBalance] = await withBalances(tenantId, [found]);
  return withBalance!;
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

/* ─────────────── Cobrança do condomínio → contas a receber ──────────────────
 * Orquestração: este service junta imóveis (property), locatários (contract) e
 * despesas (repo próprio), delega o cálculo a `buildCondoBilling` e manda
 * gravar em `receivable`. Sempre pelos services públicos dos outros módulos —
 * nenhum repository alheio é tocado aqui. */

/** Prévia da cobrança: o que seria gerado, sem gravar nada. */
export async function previewBilling(
  tenantId: string,
  condominiumId: string,
  query: CondoBillingQuery,
): Promise<CondoBillingPreview> {
  const condominium = await getById(tenantId, condominiumId);

  const [properties, expenses] = await Promise.all([
    propertyService.listByCondominium(tenantId, condominiumId),
    repo.sumExpensesInPeriod(tenantId, condominiumId, query.periodStart, query.periodEnd),
  ]);

  const propertyIds = properties.map((p) => p.id);
  const competence = competenceOf(query.periodStart);

  const [activeTenants, billed] = await Promise.all([
    contractService.findActiveTenants(tenantId, propertyIds),
    receivableService.listCondoBilled(tenantId, competence, propertyIds),
  ]);

  const tenantByProperty = new Map<string, ActiveTenant>(
    activeTenants.map((t) => [t.propertyId, { personId: t.personId, personName: t.personName }]),
  );

  const lines = buildCondoBilling({
    properties,
    tenantByProperty,
    expensesTotalCents: expenses.totalCents,
    periodStart: query.periodStart,
    periodEnd: query.periodEnd,
    billedPropertyIds: new Set(billed),
  });

  return {
    condominiumId,
    condominiumName: condominium.name,
    periodStart: query.periodStart,
    periodEnd: query.periodEnd,
    dueDate: query.dueDate,
    competence,
    months: monthsInPeriod(query.periodStart, query.periodEnd),
    unitCount: properties.length,
    expensesCount: expenses.count,
    expensesTotalCents: expenses.totalCents,
    totalCents: lines.reduce((sum, l) => sum + l.totalCents, 0),
    lines,
  };
}

/**
 * Cobranças de condomínio já geradas — o que a lista de condôminos precisa para
 * oferecer o boleto de cada unidade.
 */
export async function listCharges(
  tenantId: string,
  condominiumId: string,
): Promise<Receivable[]> {
  await getById(tenantId, condominiumId);
  return receivableService.listCondoCharges(tenantId, condominiumId);
}

/**
 * Relatório de conferência em PDF — a mesma prévia, mais as despesas que
 * formaram o rateio. Emitido ANTES de gerar, para conferir no papel.
 */
export async function billingReport(
  tenantId: string,
  condominiumId: string,
  query: CondoBillingQuery,
): Promise<Buffer> {
  const [preview, expenses, tenant] = await Promise.all([
    previewBilling(tenantId, condominiumId, query),
    repo.listExpensesInPeriod(tenantId, condominiumId, query.periodStart, query.periodEnd),
    tenantService.getById(tenantId),
  ]);

  return htmlToPdf(
    toBillingReportHtml({
      tenantName: tenant.name,
      preview,
      expenses,
      generatedAt: new Date(),
    }),
  );
}

/**
 * Gera as contas a receber do período. Recalcula a prévia (nada vem do cliente
 * além de período e vencimento — valor enviado pela tela seria valor que o
 * usuário pode adulterar) e grava só o que tem pagador e ainda não foi cobrado.
 */
export async function generateBilling(
  tenantId: string,
  condominiumId: string,
  query: CondoBillingQuery,
): Promise<CondoBillingResult> {
  const preview = await previewBilling(tenantId, condominiumId, query);

  const period = `${formatDay(query.periodStart)} a ${formatDay(query.periodEnd)}`;
  const rows: CondoChargeRow[] = preview.lines
    .filter((l) => l.payerPersonId !== null && !l.alreadyBilled && l.totalCents > 0)
    .map((l) => ({
      propertyId: l.propertyId,
      payerPersonId: l.payerPersonId!,
      description: `Condomínio ${preview.condominiumName} · ${period}`,
      competence: preview.competence,
      amountCents: l.totalCents,
      dueDate: query.dueDate,
    }));

  const created = await receivableService.generateCondoCharges(tenantId, condominiumId, rows);

  if (created > 0) {
    await publish({
      type: "condominium.charges_generated",
      tenantId,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { condominiumId, competence: preview.competence, charges: created },
    });
  }

  return { ...preview, created, skipped: preview.lines.length - created };
}

/** YYYY-MM-DD → DD/MM/AAAA (só para a descrição da cobrança). */
function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
