import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";

/**
 * Cliente HTTP do Asaas (api.asaas.com/v3). Mesmo estilo do `zapsign.client`:
 * nenhuma falha é engolida — quem chamou pediu um boleto, então erro de rede ou
 * de credencial vira um AppError legível.
 *
 * As credenciais chegam SEMPRE por parâmetro, nunca de config global: a chave é
 * por tenant (tenant_payment_settings) e usar a errada emitiria a cobrança de
 * uma imobiliária na conta bancária de outra.
 *
 * Docs: https://docs.asaas.com/reference
 */

export interface Credentials {
  /** Chave de API da conta Asaas do tenant (decifrada). */
  apiKey: string;
  /** true → api-sandbox.asaas.com (conta de testes, dinheiro fictício). */
  sandbox: boolean;
}

/** Formas de recebimento. UNDEFINED deixa o pagador escolher boleto ou PIX. */
export type BillingType = "UNDEFINED" | "BOLETO" | "PIX" | "CREDIT_CARD";

export interface AsaasCustomer {
  id: string;
  name: string;
  cpfCnpj: string;
}

export interface AsaasPayment {
  id: string;
  customer: string;
  status: string; // PENDING | RECEIVED | CONFIRMED | OVERDUE | REFUNDED …
  value: number;
  dueDate: string;
  /** Fatura web: mostra boleto E PIX ao pagador. */
  invoiceUrl: string | null;
  /** PDF do boleto registrado (só quando o billingType o inclui). */
  bankSlipUrl: string | null;
  externalReference: string | null;
  paymentDate: string | null;
  clientPaymentDate: string | null;
  netValue: number | null;
}

export interface CreateCustomerInput {
  name: string;
  /** Obrigatório no Asaas — sem CPF/CNPJ não existe cliente. */
  cpfCnpj: string;
  email?: string;
  mobilePhone?: string;
  postalCode?: string;
  address?: string;
  addressNumber?: string;
  province?: string;
  /** Nosso id da pessoa — facilita reconciliar no painel do Asaas. */
  externalReference?: string;
}

export interface CreatePaymentInput {
  customer: string;
  billingType: BillingType;
  /** Em REAIS (o Asaas trabalha com decimal, não centavos). */
  value: number;
  dueDate: string; // YYYY-MM-DD
  description?: string;
  /** Nosso id da parcela — volta no webhook para correlacionar. */
  externalReference?: string;
  /** Multa por atraso, em % do valor. */
  fine?: { value: number };
  /** Juros ao mês, em %. */
  interest?: { value: number };
}

function baseUrl(creds: Credentials): string {
  return creds.sandbox ? env.ASAAS_SANDBOX_API_URL : env.ASAAS_API_URL;
}

/** Corpo de erro do Asaas: `{ errors: [{ code, description }] }`. */
interface AsaasErrorBody {
  errors?: { code?: string; description?: string }[];
}

/**
 * Executa a chamada e normaliza os modos de falha. `context` entra na mensagem
 * para o usuário saber qual etapa quebrou.
 */
async function request<T>(
  creds: Credentials,
  path: string,
  init: { method: string; body?: unknown },
  context: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(creds)}${path}`, {
      method: init.method,
      headers: {
        access_token: creds.apiKey,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    logger.warn({ err, path }, "falha ao contatar o Asaas");
    throw new AppError(
      "INTERNAL",
      502,
      `Não foi possível contatar o Asaas (${context}). Verifique a conexão e tente novamente.`,
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new AppError(
      "UNAUTHORIZED",
      401,
      "Chave de API do Asaas inválida ou sem permissão. Revise a integração em Configurações.",
    );
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as AsaasErrorBody;
    // O Asaas descreve bem o que faltou ("O CPF informado é inválido"); repassar
    // isso poupa o operador de adivinhar qual campo do cadastro está errado.
    const detail = body.errors?.map((e) => e.description).filter(Boolean).join("; ");
    logger.warn({ status: res.status, detail, path }, "Asaas respondeu com erro");
    throw new AppError(
      "INTERNAL",
      502,
      detail
        ? `O Asaas recusou a operação (${context}): ${detail}`
        : `O Asaas recusou a operação (${context}).`,
      { status: res.status },
    );
  }

  return (await res.json()) as T;
}

/**
 * Confere se a chave é aceita, sem criar nada — uma credencial inválida só
 * apareceria na hora de emitir um boleto de verdade.
 */
export async function validateKey(creds: Credentials): Promise<void> {
  await request(creds, "/customers?limit=1", { method: "GET" }, "validação da chave");
}

export function createCustomer(
  creds: Credentials,
  input: CreateCustomerInput,
): Promise<AsaasCustomer> {
  return request<AsaasCustomer>(creds, "/customers", { method: "POST", body: input }, "cadastro do cliente");
}

export function createPayment(
  creds: Credentials,
  input: CreatePaymentInput,
): Promise<AsaasPayment> {
  return request<AsaasPayment>(creds, "/payments", { method: "POST", body: input }, "emissão da cobrança");
}

export function getPayment(creds: Credentials, paymentId: string): Promise<AsaasPayment> {
  return request<AsaasPayment>(creds, `/payments/${paymentId}`, { method: "GET" }, "consulta da cobrança");
}

/**
 * Registra o webhook da conta. O Asaas devolve o `authToken` no header
 * `asaas-access-token` de cada callback — é assim que autenticamos a chamada
 * (não há HMAC).
 *
 * `sendType: SEQUENTIALLY` mantém a ordem dos eventos e, em caso de erro,
 * interrompe a fila em vez de embaralhar o estado das cobranças.
 */
export function registerWebhook(
  creds: Credentials,
  url: string,
  authToken: string,
  email: string,
): Promise<unknown> {
  return request(
    creds,
    "/webhooks",
    {
      method: "POST",
      body: {
        name: "Offices AI Imobiliária",
        url,
        email,
        enabled: true,
        interrupted: false,
        authToken,
        sendType: "SEQUENTIALLY",
        events: [
          "PAYMENT_CREATED",
          "PAYMENT_RECEIVED",
          "PAYMENT_CONFIRMED",
          "PAYMENT_OVERDUE",
          "PAYMENT_REFUNDED",
          "PAYMENT_DELETED",
        ],
      },
    },
    "registro do webhook",
  );
}
