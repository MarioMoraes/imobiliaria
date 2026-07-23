import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { decrypt, encrypt, randomSecret, secretEquals } from "../../shared/crypto.js";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { logger } from "../../shared/logger.js";
import * as personService from "../person/person.service.js";
import * as receivableService from "../receivable/receivable.service.js";
import * as repo from "./payment.repository.js";
import * as asaas from "./asaas.client.js";
import type {
  IssuedCharge,
  PaymentCredentials,
  PaymentSettingsView,
  SavePaymentSettingsInput,
  WebhookPayload,
} from "./payment.schema.js";

/**
 * Regras da cobrança bancária. O provedor é o Asaas, mas o service fala em
 * "cobrança/cliente" e traduz na fronteira — trocar de provedor mexe em
 * `asaas.client.ts` e nos mapeamentos daqui, não no fluxo.
 *
 * Dependências: este módulo chama `receivable.service` e `person.service`
 * (públicos). O contrário não acontece — contas a receber não conhecem o Asaas.
 */

/* ---------------------------------------------- Configuração do tenant */

/** Endereço que o Asaas chama de volta. O tenant vai na URL (ver routes). */
export function webhookUrlFor(tenantId: string): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/webhooks/asaas/${tenantId}`;
}

/** Localhost não é alcançável pelo Asaas — nesse caso pulamos o registro. */
function isPubliclyReachable(url: string): boolean {
  return !/localhost|127\.0\.0\.1|0\.0\.0\.0|\.local(\b|\/)/i.test(url);
}

export async function getSettings(tenantId: string): Promise<PaymentSettingsView> {
  const row = await repo.findSettings(tenantId);
  return {
    connected: Boolean(row?.apiKeyEnc),
    provider: row?.provider ?? "ASAAS",
    sandbox: row?.sandbox ?? true,
    billingType: row?.billingType ?? "UNDEFINED",
    apiKeyHint: row?.apiKeyHint ?? null,
    webhookUrl: webhookUrlFor(tenantId),
    webhookRegisteredAt: row?.webhookRegisteredAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * Conecta (ou reconfigura) a conta Asaas do tenant. A chave é validada contra a
 * API ANTES de ser gravada — uma credencial inválida salva só apareceria na
 * hora de emitir um boleto de verdade.
 */
export async function saveSettings(
  tenantId: string,
  input: SavePaymentSettingsInput,
): Promise<PaymentSettingsView> {
  const current = await repo.findSettings(tenantId);
  const apiKey = input.apiKey ?? (current?.apiKeyEnc ? decrypt(current.apiKeyEnc) : null);
  if (!apiKey) {
    throw new AppError("ERR_FIN_002", 400, "Informe a chave de API do Asaas.");
  }

  await asaas.validateKey({ apiKey, sandbox: input.sandbox });

  await repo.upsertSettings(tenantId, {
    apiKeyEnc: input.apiKey ? encrypt(input.apiKey) : undefined,
    apiKeyHint: input.apiKey ? input.apiKey.slice(-4) : undefined,
    sandbox: input.sandbox,
    billingType: input.billingType,
    webhookToken: current?.webhookToken ?? randomSecret(),
  });

  const saved = await repo.findSettings(tenantId);
  const url = webhookUrlFor(tenantId);
  if (isPubliclyReachable(url) && saved?.webhookToken) {
    try {
      await asaas.registerWebhook(
        { apiKey, sandbox: input.sandbox },
        url,
        saved.webhookToken,
        // O Asaas exige um e-mail para avisar quando a fila do webhook para.
        `financeiro+${tenantId}@officesai.com.br`,
      );
      await repo.markWebhookRegistered(tenantId);
    } catch (err) {
      // Webhook é conveniência: sem ele o operador ainda baixa na mão.
      logger.warn({ err, tenantId }, "não foi possível registrar o webhook no Asaas");
    }
  }

  return getSettings(tenantId);
}

export async function disconnect(tenantId: string): Promise<void> {
  const removed = await repo.clearCredentials(tenantId);
  if (!removed) throw AppError.notFound("Integração de cobrança não configurada");
}

/** Credenciais decifradas do tenant. Erra cedo se ninguém conectou a conta. */
async function credentials(tenantId: string): Promise<PaymentCredentials> {
  const row = await repo.findSettings(tenantId);
  if (!row?.apiKeyEnc || !row.webhookToken) {
    throw new AppError(
      "ERR_FIN_002",
      422,
      "Cobrança bancária não configurada. Conecte a conta Asaas da imobiliária em Configurações.",
    );
  }

  // A chave guardada pode ser ilegível: APP_ENCRYPTION_KEY trocada, valor
  // corrompido ou gravado por outro ambiente. Sem este guard o erro sobe cru.
  let apiKey: string;
  try {
    apiKey = decrypt(row.apiKeyEnc);
  } catch (err) {
    logger.error({ err, tenantId }, "credencial de cobrança ilegível");
    throw new AppError(
      "ERR_FIN_002",
      422,
      "Não foi possível ler as credenciais do Asaas (chave de criptografia diferente da usada ao salvar). Reconecte a conta em Configurações.",
    );
  }

  return {
    apiKey,
    sandbox: row.sandbox,
    billingType: row.billingType,
    webhookToken: row.webhookToken,
  };
}

/* ------------------------------------------------ Cliente (pessoa → Asaas) */

const digits = (v: string | null | undefined): string => (v ?? "").replace(/\D/g, "");

/**
 * Garante o cliente da pessoa no Asaas, reaproveitando o vínculo já gravado.
 * O CPF/CNPJ é obrigatório lá — sem ele a cobrança não existe, então o erro
 * aponta direto para o cadastro que falta preencher.
 */
async function ensureCustomer(
  tenantId: string,
  creds: PaymentCredentials,
  personId: string,
): Promise<string> {
  const existing = await repo.findCustomerId(tenantId, personId, creds.sandbox);
  if (existing) return existing;

  const person = await personService.getById(tenantId, personId);
  const cpfCnpj = digits(person.cpfCnpj);
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    throw new AppError(
      "ERR_FIN_002",
      422,
      `Cadastre o CPF/CNPJ de ${person.fullName} para emitir a cobrança — o Asaas exige o documento do pagador.`,
    );
  }

  const mobile = digits(person.mobile ?? person.phone);
  const customer = await asaas.createCustomer(
    { apiKey: creds.apiKey, sandbox: creds.sandbox },
    {
      name: person.fullName,
      cpfCnpj,
      email: person.email ?? undefined,
      mobilePhone: mobile.length >= 10 ? mobile : undefined,
      externalReference: personId,
    },
  );

  await repo.linkCustomer(tenantId, personId, creds.sandbox, customer.id);
  return customer.id;
}

/* ------------------------------------------------------ Emissão da cobrança */

/** Centavos → reais (o Asaas trabalha em decimal). */
const toReais = (cents: number): number => Math.round(cents) / 100;

/**
 * Emite (ou recupera) a cobrança da parcela e devolve o link para o operador
 * abrir/imprimir.
 *
 * Emissão **sob demanda**: a parcela só vira cobrança no Asaas quando alguém
 * pede o boleto. Assim um contrato rescindido no 2º mês não deixa dez cobranças
 * órfãs no provedor, e reajuste no meio do caminho não obriga a cancelar e
 * reemitir o que já foi registrado.
 *
 * Idempotente: parcela que já tem cobrança devolve o link existente sem tocar
 * no Asaas.
 */
export async function issueCharge(
  tenantId: string,
  receivableId: string,
): Promise<IssuedCharge> {
  const receivable = await receivableService.getById(tenantId, receivableId);

  // Já emitida: as URLs do Asaas não expiram, então basta devolvê-las.
  if (receivable.asaasChargeId) {
    const url = receivable.boletoUrl ?? receivable.invoiceUrl;
    if (url) {
      return {
        url,
        asaasChargeId: receivable.asaasChargeId,
        boletoUrl: receivable.boletoUrl,
        invoiceUrl: receivable.invoiceUrl,
      };
    }
  }

  if (receivable.status === "CANCELADO" || receivable.status === "ESTORNADO") {
    throw AppError.badRequest("Parcela cancelada não gera cobrança.");
  }
  if (receivable.status === "PAGO") {
    throw AppError.badRequest("Parcela já quitada — não há cobrança a emitir.");
  }
  if (!receivable.payerPersonId) {
    throw new AppError(
      "ERR_FIN_002",
      422,
      "Parcela sem pagador. Vincule o locatário ao contrato antes de emitir a cobrança.",
    );
  }

  const creds = await credentials(tenantId);
  const customerId = await ensureCustomer(tenantId, creds, receivable.payerPersonId);

  const payment = await asaas.createPayment(
    { apiKey: creds.apiKey, sandbox: creds.sandbox },
    {
      customer: customerId,
      billingType: creds.billingType as asaas.BillingType,
      value: toReais(receivable.amountCents),
      dueDate: receivable.dueDate,
      description: receivable.description ?? "Aluguel",
      externalReference: receivable.id,
      ...(await chargeTerms(tenantId, receivable.contractId)),
    },
  );

  await receivableService.attachCharge(tenantId, receivable.id, {
    asaasChargeId: payment.id,
    boletoUrl: payment.bankSlipUrl,
    invoiceUrl: payment.invoiceUrl,
  });

  await publish({
    type: "receivable.charge_issued",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { receivableId: receivable.id, chargeId: payment.id, sandbox: creds.sandbox },
  });

  // `url` é o que o botão de impressão abre: o PDF do boleto quando existe
  // (imprimível direto), caindo na fatura web — que mostra boleto E PIX — nos
  // casos em que o billingType não gera boleto (ex.: PIX puro).
  const url = payment.bankSlipUrl ?? payment.invoiceUrl;
  if (!url) {
    throw new AppError("INTERNAL", 502, "Cobrança criada, mas o Asaas não devolveu o link.");
  }

  return {
    url,
    asaasChargeId: payment.id,
    boletoUrl: payment.bankSlipUrl,
    invoiceUrl: payment.invoiceUrl,
  };
}

/**
 * Multa e juros por atraso saem do próprio contrato (campos Multa e Juros), em
 * percentual — é o Asaas que os aplica na compensação. Sem contrato ou sem os
 * percentuais, a cobrança sai sem encargos.
 */
async function chargeTerms(
  tenantId: string,
  contractId: string | null,
): Promise<{ fine?: { value: number }; interest?: { value: number } }> {
  if (!contractId) return {};
  // Import tardio: evita um ciclo estático payment → contract → receivable.
  const contractService = await import("../contract/contract.service.js");
  const contract = await contractService.getById(tenantId, contractId).catch(() => null);
  if (!contract) return {};

  return {
    ...(contract.penaltyPercent ? { fine: { value: contract.penaltyPercent } } : {}),
    ...(contract.interestPercent ? { interest: { value: contract.interestPercent } } : {}),
  };
}

/* ------------------------------------------------ Sincronização / webhook */

/** Estados do Asaas que significam dinheiro na conta. */
const PAID_EVENTS = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]);

/** "2026-08-10 13:45:00" | "2026-08-10" → "2026-08-10". */
const toDay = (v: string | null | undefined): string | undefined =>
  v ? v.slice(0, 10) : undefined;

/**
 * Aplica um callback do Asaas. Retorna `false` quando o token não confere — a
 * rota traduz isso em 401 sem revelar se o tenant existe.
 *
 * Idempotente por `event.id` (o Asaas reentrega até receber 200): o evento é
 * "reivindicado" no banco antes de qualquer efeito.
 */
export async function handleWebhook(
  tenantId: string,
  token: string | undefined,
  payload: WebhookPayload,
): Promise<boolean> {
  const row = await repo.findSettings(tenantId);
  if (!row?.webhookToken || !token || !secretEquals(token, row.webhookToken)) {
    return false;
  }

  const payment = payload.payment;
  if (!payment) {
    logger.info({ tenantId, event: payload.event }, "webhook do Asaas sem cobrança — ignorado");
    return true;
  }

  // Sem `id` do evento (formatos antigos), o id da cobrança + o tipo servem de
  // chave: reentregas do mesmo evento continuam colapsando em uma só.
  const eventId = payload.id ?? `${payload.event}:${payment.id}`;
  const fresh = await repo.claimEvent(tenantId, {
    eventId,
    eventType: payload.event,
    paymentId: payment.id,
    payload,
  });
  if (!fresh) {
    logger.info({ tenantId, eventId }, "evento do Asaas já processado — ignorado");
    return true;
  }

  if (PAID_EVENTS.has(payload.event)) {
    const settled = await receivableService.settleByChargeId(tenantId, payment.id, {
      paidAt: toDay(payment.clientPaymentDate ?? payment.paymentDate),
      paidAmountCents:
        payment.value === undefined ? undefined : Math.round(payment.value * 100),
    });
    if (!settled) {
      // Cobrança criada fora do sistema, na mesma conta Asaas: ignorar é o certo.
      logger.info({ tenantId, chargeId: payment.id }, "cobrança desconhecida — ignorada");
    }
  } else if (payload.event === "PAYMENT_OVERDUE") {
    await receivableService.markOverdueByChargeId(tenantId, payment.id);
  }

  return true;
}

/**
 * "Sincronizar": consulta o Asaas e aplica o estado atual da cobrança. É o
 * caminho manual, indispensável em desenvolvimento — o webhook não alcança a
 * máquina local.
 */
export async function syncCharge(tenantId: string, receivableId: string): Promise<void> {
  const receivable = await receivableService.getById(tenantId, receivableId);
  if (!receivable.asaasChargeId) {
    throw new AppError("ERR_FIN_002", 404, "Esta parcela ainda não tem cobrança emitida.");
  }

  const creds = await credentials(tenantId);
  const payment = await asaas.getPayment(
    { apiKey: creds.apiKey, sandbox: creds.sandbox },
    receivable.asaasChargeId,
  );

  if (payment.status === "RECEIVED" || payment.status === "CONFIRMED") {
    await receivableService.settleByChargeId(tenantId, payment.id, {
      paidAt: toDay(payment.clientPaymentDate ?? payment.paymentDate),
      paidAmountCents: Math.round(payment.value * 100),
    });
  } else if (payment.status === "OVERDUE") {
    await receivableService.markOverdueByChargeId(tenantId, payment.id);
  }
}
