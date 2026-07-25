import { env } from "../config/env.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";

/**
 * Envio de e-mail transacional (Resend). Isolado aqui para ser o ÚNICO ponto
 * que conhece o provedor — o resto do backend depende só de `sendEmail`.
 * Trocar de provedor = trocar este arquivo.
 *
 * Por que não usamos a entrega do Clerk: a instância de desenvolvimento envia
 * do domínio compartilhado `@accounts.dev`, sem SPF/DKIM, e na prática não
 * entrega. O convite continua sendo CRIADO no Clerk (é ele que emite o ticket
 * de aceite); só a entrega do e-mail é nossa.
 *
 * Diferente da ZapSign/Asaas, a credencial NÃO é por tenant: quem envia é a
 * plataforma, a partir do seu próprio domínio verificado.
 *
 * Docs: https://resend.com/docs/api-reference/emails/send-email
 */

export function isMailerConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Alternativa em texto puro — melhora a entrega e cobre clientes sem HTML. */
  text: string;
}

/**
 * Envia o e-mail. Não engole falha: quem chamou pediu um envio, então erro de
 * rede/credencial/recusa vira um AppError legível. O caller decide se isso é
 * fatal (ver `employee.service.ts`: convite não some por falha de e-mail).
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (!isMailerConfigured()) {
    throw new AppError("ERR_MAIL_001", 503, "Envio de e-mail não configurado (defina RESEND_API_KEY)");
  }

  let res: Response;
  try {
    res = await fetch(`${env.RESEND_API_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
  } catch (err) {
    logger.warn({ err }, "falha ao contatar o Resend");
    throw new AppError("ERR_MAIL_002", 502, "Não foi possível contatar o serviço de e-mail.");
  }

  if (res.status === 401 || res.status === 403) {
    // 403 também é o que o Resend devolve ao tentar enviar de um domínio não
    // verificado para um destinatário que não é o dono da conta.
    const detail = await res.text().catch(() => "");
    logger.warn({ status: res.status, detail }, "Resend recusou a credencial/remetente");
    throw new AppError("ERR_MAIL_003", 502, "O serviço de e-mail recusou o envio.", {
      hint: "verifique a RESEND_API_KEY e se o domínio do MAIL_FROM está verificado no Resend",
      detail: detail.slice(0, 500),
    });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logger.warn({ status: res.status, detail }, "Resend respondeu com erro");
    throw new AppError("ERR_MAIL_004", 502, "O serviço de e-mail recusou o envio.", {
      status: res.status,
      detail: detail.slice(0, 500),
    });
  }
}
