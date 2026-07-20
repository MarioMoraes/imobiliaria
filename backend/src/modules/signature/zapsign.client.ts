import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";

/**
 * Cliente HTTP da ZapSign (api.zapsign.com.br). Segue o estilo de
 * `shared/pdf.ts`: nenhuma falha é engolida em silêncio — quem chamou pediu uma
 * assinatura, então erro de rede/credencial vira um AppError legível.
 *
 * As credenciais chegam SEMPRE por parâmetro (`Credentials`), nunca de config
 * global: o token é por tenant (tenant_signature_settings) e usar o token
 * errado enviaria o contrato de uma imobiliária pela conta de outra.
 *
 * Docs: https://docs.zapsign.com.br
 */

export interface Credentials {
  /** Token da conta ZapSign do tenant (decifrado). */
  token: string;
  /** true → sandbox.api.zapsign.com.br (sem validade jurídica, para testes). */
  sandbox: boolean;
}

/** Modos de autenticação do signatário aceitos pela API. */
export const AUTH_MODES = [
  "assinaturaTela",
  "tokenEmail",
  "assinaturaTela-tokenEmail",
  "tokenSms",
  "assinaturaTela-tokenSms",
  "tokenWhatsApp",
  "assinaturaTela-tokenWhatsApp",
  "certificadoDigital",
] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export interface ZapSignSigner {
  token: string;
  name: string;
  email: string | null;
  status: string; // new | link-opened | signed
  sign_url: string | null;
  signed_at: string | null;
}

export interface ZapSignDoc {
  token: string;
  name: string;
  status: string; // pending | signed
  external_id: string | null;
  original_file: string | null;
  signed_file: string | null;
  signers: ZapSignSigner[];
}

export interface CreateDocInput {
  name: string;
  base64Pdf: string;
  /** Nosso id do contrato — volta no webhook, útil para correlacionar. */
  externalId: string;
  signers: {
    name: string;
    email?: string;
    phoneCountry?: string;
    phoneNumber?: string;
    cpf?: string;
    authMode: string;
  }[];
}

function baseUrl(creds: Credentials): string {
  return creds.sandbox ? env.ZAPSIGN_SANDBOX_API_URL : env.ZAPSIGN_API_URL;
}

/**
 * Executa a chamada e normaliza os modos de falha. `context` entra na mensagem
 * de erro para o usuário saber qual etapa falhou.
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
        Authorization: `Bearer ${creds.token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    logger.warn({ err, path }, "falha ao contatar a ZapSign");
    throw new AppError(
      "INTERNAL",
      502,
      `Não foi possível contatar a ZapSign (${context}). Verifique a conexão e tente novamente.`,
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new AppError(
      "UNAUTHORIZED",
      401,
      "Token da ZapSign inválido ou sem permissão. Revise a integração em Configurações.",
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logger.warn({ status: res.status, detail, path }, "ZapSign respondeu com erro");
    throw new AppError("INTERNAL", 502, `A ZapSign recusou a operação (${context}).`, {
      status: res.status,
      // O corpo de erro da ZapSign é pequeno e sem PII; ajuda muito no suporte.
      detail: detail.slice(0, 500),
    });
  }

  return (await res.json()) as T;
}

/** Cria o documento a partir do PDF em base64 e dispara os convites. */
export function createDoc(creds: Credentials, input: CreateDocInput): Promise<ZapSignDoc> {
  return request<ZapSignDoc>(
    creds,
    "/docs/",
    {
      method: "POST",
      body: {
        name: input.name.slice(0, 255),
        base64_pdf: input.base64Pdf,
        external_id: input.externalId,
        lang: "pt-br",
        signers: input.signers.map((s) => ({
          name: s.name,
          email: s.email,
          phone_country: s.phoneCountry,
          phone_number: s.phoneNumber,
          cpf: s.cpf,
          auth_mode: s.authMode,
          send_automatic_email: Boolean(s.email),
        })),
      },
    },
    "criação do documento",
  );
}

/**
 * Confere se a credencial é aceita, sem criar nada. Lista a primeira página de
 * documentos — 401 vira erro amigável; qualquer 2xx significa token válido.
 */
export async function validateToken(creds: Credentials): Promise<void> {
  await request(creds, "/docs/?page=1", { method: "GET" }, "validação do token");
}

/** Estado atual do documento — base do "Sincronizar status". */
export function getDoc(creds: Credentials, docToken: string): Promise<ZapSignDoc> {
  return request<ZapSignDoc>(creds, `/docs/${docToken}/`, { method: "GET" }, "consulta do documento");
}

/**
 * Registra o webhook da conta. A ZapSign não assina os callbacks (não há HMAC):
 * a autenticidade vem do header customizado que mandamos aqui e conferimos na
 * chegada.
 */
export function registerWebhook(
  creds: Credentials,
  url: string,
  secretHeader: { name: string; value: string },
): Promise<unknown> {
  return request(
    creds,
    "/user/company/webhook/",
    {
      method: "POST",
      body: {
        url,
        type: "doc_signed",
        headers: [{ name: secretHeader.name, value: secretHeader.value }],
      },
    },
    "registro do webhook",
  );
}

/**
 * Baixa o PDF assinado. A URL do provedor expira em 60 minutos — por isso o
 * binário é copiado para o nosso storage assim que a assinatura conclui.
 */
export async function downloadSignedFile(url: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    logger.warn({ err }, "falha ao baixar o PDF assinado da ZapSign");
    throw new AppError("INTERNAL", 502, "Não foi possível baixar o contrato assinado.");
  }
  if (!res.ok) {
    throw new AppError("INTERNAL", 502, "Link do contrato assinado expirado ou indisponível.");
  }
  return Buffer.from(await res.arrayBuffer());
}
