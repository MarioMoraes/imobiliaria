import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { decrypt, encrypt, randomSecret, secretEquals } from "../../shared/crypto.js";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { logger } from "../../shared/logger.js";
import * as personService from "../person/person.service.js";
import * as receivableService from "../receivable/receivable.service.js";
import * as payableService from "../payable/payable.service.js";
import * as repo from "./payment.repository.js";
import * as asaas from "./asaas.client.js";
import type { Receivable } from "../receivable/receivable.schema.js";
import type {
  IssuedCharge,
  IssuedTransfer,
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
      ...(await chargeTerms(tenantId, receivable)),
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
 * Multa e juros por atraso, em percentual — é o Asaas que os aplica na
 * compensação. A origem depende do que está sendo cobrado: parcela de aluguel
 * usa os campos Multa/Juros do CONTRATO; cobrança de condomínio usa os do
 * CONDOMÍNIO (que tem os seus próprios no cadastro).
 *
 * Sem nenhuma das duas origens, ou sem os percentuais, a cobrança sai sem
 * encargos — atraso não é cobrado por conta própria.
 *
 * Exportada porque é a regra que decide o que o pagador deve a mais por atraso:
 * dentro de `issueCharge` só seria alcançável com credenciais do Asaas, e
 * emitir sem encargos um boleto de condomínio que tem multa cadastrada é um
 * erro silencioso — dinheiro que a imobiliária deixa de cobrar.
 */
export async function chargeTerms(
  tenantId: string,
  receivable: Pick<Receivable, "contractId" | "condominiumId">,
): Promise<{ fine?: { value: number }; interest?: { value: number } }> {
  // Imports tardios: evitam ciclos estáticos (payment → contract → receivable e
  // payment → condominium → receivable).
  if (receivable.contractId) {
    const contractService = await import("../contract/contract.service.js");
    const contract = await contractService
      .getById(tenantId, receivable.contractId)
      .catch(() => null);
    if (contract) return terms(contract.penaltyPercent, contract.interestPercent);
  }

  if (receivable.condominiumId) {
    const condominiumService = await import("../condominium/condominium.service.js");
    const condominium = await condominiumService
      .getById(tenantId, receivable.condominiumId)
      .catch(() => null);
    if (condominium) return terms(condominium.penaltyPercent, condominium.interestPercent);
  }

  return {};
}

function terms(
  penaltyPercent: number | null,
  interestPercent: number | null,
): { fine?: { value: number }; interest?: { value: number } } {
  return {
    ...(penaltyPercent ? { fine: { value: penaltyPercent } } : {}),
    ...(interestPercent ? { interest: { value: interestPercent } } : {}),
  };
}

/* -------------------------------------- Repasse ao proprietário (saída) */

/**
 * Envia o repasse por PIX para a chave do proprietário.
 *
 * Sob demanda, como a emissão do boleto: o lançamento só vira transferência no
 * Asaas quando alguém manda pagar. E **assíncrono** — o Asaas devolve `PENDING`,
 * o repasse fica `PROCESSANDO`, e a baixa só acontece quando chega
 * `TRANSFER_DONE` (webhook) ou na sincronização manual. Marcar PAGO aqui diria
 * que o proprietário recebeu um dinheiro que ainda está em trânsito.
 *
 * Idempotente: repasse que já tem transferência não cria uma segunda — pagar o
 * mesmo aluguel duas vezes é dinheiro que não volta sozinho.
 */
export function transferPayout(
  tenantId: string,
  payableId: string,
): Promise<IssuedTransfer> {
  return transferPayouts(tenantId, [payableId]);
}

/**
 * Um PIX só para vários repasses do mesmo proprietário.
 *
 * Por que em lote e não N transferências: o proprietário de três imóveis recebe
 * um crédito só no extrato (é o que ele espera ver), a imobiliária paga uma
 * tarifa em vez de três, e a conciliação passa a ter uma linha por pagamento em
 * vez de três parciais. Os lançamentos continuam separados no sistema — o que se
 * agrupa é o dinheiro, não a contabilidade: cada repasse mantém sua competência,
 * seu imóvel e sua taxa, e todos apontam para a mesma `asaas_transfer_id`.
 *
 * Idempotente: um conjunto já enviado devolve a transferência existente em vez
 * de criar a segunda — pagar o mesmo aluguel duas vezes é dinheiro que não volta
 * sozinho. Se só PARTE da seleção já foi enviada, recusa: incluí-la de novo
 * duplicaria o valor dela dentro do lote.
 */
export async function transferPayouts(
  tenantId: string,
  payableIds: string[],
): Promise<IssuedTransfer> {
  // A validação de "mesmo proprietário" mora no payable.service: é a regra que o
  // recibo também usa, e o destino do PIX é uma chave só.
  const payables = await payableService.selectedPayables(tenantId, payableIds);

  const enviados = payables.filter((p) => p.asaasTransferId);
  if (enviados.length) {
    const transferencias = new Set(enviados.map((p) => p.asaasTransferId));
    if (enviados.length === payables.length && transferencias.size === 1) {
      const primeiro = enviados[0]!;
      return {
        asaasTransferId: primeiro.asaasTransferId!,
        status: primeiro.transferStatus ?? "PENDING",
      };
    }
    throw AppError.badRequest(
      `${enviados.length} lançamento(s) da seleção já foram enviados ao banco. Desmarque-os para enviar o restante.`,
    );
  }

  const quitados = payables.filter((p) => p.status === "PAGO");
  if (quitados.length) {
    throw AppError.badRequest("Repasse já quitado — não há pagamento a enviar.");
  }
  const cancelados = payables.filter(
    (p) => p.status === "CANCELADO" || p.status === "ESTORNADO",
  );
  if (cancelados.length) {
    throw AppError.badRequest("Repasse cancelado não gera pagamento.");
  }

  const person = await personService.getById(tenantId, payables[0]!.payeePersonId);
  const pixKey = person.pixKey?.trim();
  if (!pixKey || !person.pixKeyType) {
    throw new AppError(
      "ERR_FIN_002",
      422,
      `Cadastre a chave PIX de ${person.fullName} para enviar o repasse — é por ela que o Asaas transfere.`,
    );
  }

  const totalCents = payables.reduce((sum, p) => sum + p.amountCents, 0);
  const unico = payables.length === 1 ? payables[0]! : null;
  // Referência externa: o id do lançamento quando é um só. Num lote não cabe a
  // lista de ids, e não faz falta — a correlação do webhook é por `transfer.id`,
  // que fica gravado em todos os lançamentos do grupo.
  const externalReference = unico ? unico.id : `lote:${randomUUID()}`;

  const creds = await credentials(tenantId);
  const transfer = await asaas.createTransfer(
    { apiKey: creds.apiKey, sandbox: creds.sandbox },
    {
      value: toReais(totalCents),
      pixAddressKey: pixKey,
      pixAddressKeyType: person.pixKeyType as asaas.PixKeyType,
      description: unico
        ? (unico.description ?? "Repasse de aluguel")
        : `Repasse de aluguel · ${payables.length} lançamentos`,
      externalReference,
    },
  );

  await payableService.attachTransfer(
    tenantId,
    payables.map((p) => p.id),
    { asaasTransferId: transfer.id, transferStatus: transfer.status },
  );

  await publish({
    type: "payable.transfer_sent",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: {
      payableIds: payables.map((p) => p.id),
      transferId: transfer.id,
      amountCents: totalCents,
      sandbox: creds.sandbox,
    },
  });

  // Raro, mas o Asaas pode concluir na hora — nesse caso já damos a baixa em vez
  // de deixar o repasse preso em PROCESSANDO até alguém sincronizar.
  if (transfer.status === "DONE") {
    await payableService.applyTransferResult(tenantId, transfer.id, {
      status: transfer.status,
      effectiveDate: toDay(transfer.effectiveDate),
    });
  }

  return { asaasTransferId: transfer.id, status: transfer.status };
}

/**
 * "Sincronizar" o repasse: consulta o Asaas e aplica o desfecho. É o caminho
 * manual, indispensável em desenvolvimento — o webhook não alcança a máquina
 * local, e sem isso o repasse ficaria PROCESSANDO para sempre.
 */
export async function syncTransfer(tenantId: string, payableId: string): Promise<void> {
  const payable = await payableService.getById(tenantId, payableId);
  if (!payable.asaasTransferId) {
    throw new AppError("ERR_FIN_002", 404, "Este repasse ainda não foi enviado ao banco.");
  }

  const creds = await credentials(tenantId);
  const transfer = await asaas.getTransfer(
    { apiKey: creds.apiKey, sandbox: creds.sandbox },
    payable.asaasTransferId,
  );

  await payableService.applyTransferResult(tenantId, transfer.id, {
    status: transfer.status,
    effectiveDate: toDay(transfer.effectiveDate),
    failReason: transfer.failReason,
  });
}

/* ------------------------------------------------ Sincronização / webhook */

/** Estados do Asaas que significam dinheiro na conta. */
const PAID_EVENTS = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]);

/** "2026-08-10 13:45:00" | "2026-08-10" → "2026-08-10". */
const toDay = (v: string | null | undefined): string | undefined =>
  v ? v.slice(0, 10) : undefined;

/**
 * Desfecho da transferência a partir do nome do evento, para os callbacks que
 * não repetem o `status` no corpo. Desconhecido vira PENDING (em trânsito) — o
 * pior erro aqui seria dar baixa por engano.
 */
function statusFromTransferEvent(event: string): string {
  if (event === "TRANSFER_DONE") return "DONE";
  if (event === "TRANSFER_FAILED") return "FAILED";
  if (event === "TRANSFER_CANCELLED") return "CANCELLED";
  if (event === "TRANSFER_IN_BANK_PROCESSING") return "BANK_PROCESSING";
  return "PENDING";
}

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

  // Um callback traz `payment` (cobrança, dinheiro entrando) ou `transfer`
  // (repasse, dinheiro saindo). O de repasse chegou depois, então o caminho de
  // cobrança abaixo continua tal como estava.
  const subject = payload.payment ?? payload.transfer;
  if (!subject) {
    logger.info({ tenantId, event: payload.event }, "webhook do Asaas sem objeto — ignorado");
    return true;
  }

  // Sem `id` do evento (formatos antigos), o id do objeto + o tipo servem de
  // chave: reentregas do mesmo evento continuam colapsando em uma só.
  const eventId = payload.id ?? `${payload.event}:${subject.id}`;
  const fresh = await repo.claimEvent(tenantId, {
    eventId,
    eventType: payload.event,
    paymentId: subject.id,
    payload,
  });
  if (!fresh) {
    logger.info({ tenantId, eventId }, "evento do Asaas já processado — ignorado");
    return true;
  }

  const transfer = payload.transfer;
  if (transfer) {
    const applied = await payableService.applyTransferResult(tenantId, transfer.id, {
      // Sem `status` no corpo, o próprio nome do evento diz o desfecho.
      status: transfer.status ?? statusFromTransferEvent(payload.event),
      effectiveDate: toDay(transfer.effectiveDate),
      failReason: transfer.failReason,
    });
    if (!applied) {
      // Transferência feita direto no painel do Asaas: ignorar é o certo.
      logger.info({ tenantId, transferId: transfer.id }, "repasse desconhecido — ignorado");
    }
    return true;
  }

  const payment = payload.payment!;
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
