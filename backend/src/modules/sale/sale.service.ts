import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { logger } from "../../shared/logger.js";
import * as commissionService from "../commission/commission.service.js";
import * as propertyService from "../property/property.service.js";
import * as repo from "./sale.repository.js";
import type {
  CreateSaleInput,
  ListSalesQuery,
  Sale,
  UpdateSaleInput,
} from "./sale.schema.js";

/**
 * Venda do imóvel (MOD-VENDA).
 *
 * Direção das dependências: importa `property` (marca o imóvel como vendido) e
 * `commission` (gera as partes da corretagem). Nada importa daqui de volta — o
 * fluxo de caixa enxerga a venda pelas COMISSÕES, que ele já lê pelo próprio
 * SELECT agregado.
 *
 * Sobre o caixa: o valor da venda é dinheiro do PROPRIETÁRIO, não da
 * imobiliária. O que é receita própria é a comissão, e por isso registrar a
 * venda não gera lançamento de caixa nenhum além dela — uma linha com o valor
 * cheio duplicaria a receita que a comissão já representa.
 */

export function list(tenantId: string, query: ListSalesQuery): Promise<Sale[]> {
  return repo.listSales(tenantId, query);
}

export async function getById(tenantId: string, id: string): Promise<Sale> {
  const sale = await repo.findSale(tenantId, id);
  if (!sale) throw AppError.notFound("Venda não encontrada");
  return sale;
}

/** A venda do imóvel, quando já registrada. Usada pelos documentos de venda. */
export async function findByProperty(
  tenantId: string,
  propertyId: string,
): Promise<Sale | null> {
  const sales = await repo.listSales(tenantId, { propertyId });
  return sales[0] ?? null;
}

/**
 * Registra a venda e dispara o fechamento.
 *
 * Um imóvel tem uma venda: registrar a segunda seria marcar duas vezes o mesmo
 * imóvel como vendido e lançar duas comissões sobre o mesmo negócio.
 */
export async function create(
  tenantId: string,
  input: CreateSaleInput,
): Promise<Sale> {
  // Valida o imóvel ANTES de gravar: `property_id` é FK lógica, então uma venda
  // com imóvel inexistente entraria calada e só apareceria na hora do documento.
  const property = await propertyService.getById(tenantId, input.propertyId);

  const existing = await findByProperty(tenantId, input.propertyId);
  if (existing) {
    throw new AppError("CONFLICT", 409, "Este imóvel já tem uma venda registrada", {
      saleId: existing.id,
    });
  }

  const sale = await repo.insertSale(tenantId, input);

  await markPropertySold(tenantId, sale.propertyId);
  await createCommissions(tenantId, sale, property.code);

  await publish({
    type: "sale.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      saleId: sale.id,
      propertyId: sale.propertyId,
      valueCents: sale.valueCents,
    },
  });

  return sale;
}

/**
 * Corrigir a venda re-tenta os dois efeitos. A comissão é idempotente por
 * `(sale_id, party, broker_id)`: completar o valor que nasceu zerado gera as
 * linhas que faltavam, sem duplicar as que já existem.
 *
 * O que ela NÃO faz é reescrever uma comissão já lançada quando o valor da
 * venda muda — e isso é deliberado. A comissão pode já estar quitada e no
 * extrato do mês; corrigir o cadastro não pode mexer no dinheiro pelas costas.
 * Fechou pelo valor errado? O acerto é no financeiro, onde o estorno aparece.
 */
export async function update(
  tenantId: string,
  id: string,
  input: UpdateSaleInput,
): Promise<Sale> {
  const updated = await repo.updateSale(tenantId, id, input);
  if (!updated) throw AppError.notFound("Venda não encontrada");

  const property = await propertyService
    .getById(tenantId, updated.propertyId)
    .catch(() => null);
  await markPropertySold(tenantId, updated.propertyId);
  await createCommissions(tenantId, updated, property?.code ?? null);

  await publish({
    type: "sale.updated",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { saleId: updated.id, propertyId: updated.propertyId },
  });

  return updated;
}

/**
 * Desfaz o registro da venda e devolve o imóvel à vitrine.
 *
 * As comissões já lançadas PERMANECEM: são trilha financeira, e uma delas pode
 * até já estar quitada. Quem desfaz o negócio cancela a comissão no financeiro,
 * onde o estorno é explícito.
 */
export async function remove(tenantId: string, id: string): Promise<void> {
  const sale = await repo.findSale(tenantId, id);
  if (!sale) throw AppError.notFound("Venda não encontrada");

  const removed = await repo.deleteSale(tenantId, id);
  if (!removed) throw AppError.notFound("Venda não encontrada");

  try {
    await propertyService.update(tenantId, sale.propertyId, {
      status: "available",
      isSold: false,
    });
  } catch (err) {
    logger.error(
      { err, tenantId, saleId: id, propertyId: sale.propertyId },
      "não foi possível devolver o imóvel à situação Disponível",
    );
  }
}

/* --------------------------------------------- Efeitos do fechamento */

/**
 * Imóvel passa a VENDIDO. Não derruba o registro da venda se falhar — mesma
 * escolha da entrada em vigência do contrato (`contract.service.activate`): um
 * imóvel apagado não pode impedir que a venda seja registrada.
 */
async function markPropertySold(tenantId: string, propertyId: string): Promise<void> {
  try {
    await propertyService.update(tenantId, propertyId, {
      status: "sold",
      isSold: true,
    });
  } catch (err) {
    logger.error(
      { err, tenantId, propertyId },
      "não foi possível marcar o imóvel como vendido",
    );
  }
}

/**
 * Gera as comissões da venda. Ao contrário do efeito acima, este **propaga** o
 * erro: é a regra documentada de `commission.createForSale` — o fechamento é
 * uma ação síncrona do operador e deve falhar visivelmente se a comissão não
 * puder ser apurada.
 */
async function createCommissions(
  tenantId: string,
  sale: Sale,
  propertyCode: number | null,
): Promise<void> {
  await commissionService.createForSale(tenantId, {
    saleId: sale.id,
    propertyId: sale.propertyId,
    saleValueCents: sale.valueCents,
    commissionPercent: sale.commissionPercent,
    brokerId: sale.brokerId,
    // Sem data de fechamento, a comissão vence hoje: o vencimento é obrigatório
    // e um lançamento sem data não apareceria em mês nenhum do fluxo de caixa.
    dueDate: sale.soldAt ?? new Date().toISOString().slice(0, 10),
    reference: propertyCode != null ? `Imóvel ${propertyCode}` : null,
  });
}
