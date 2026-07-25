/**
 * Corpo do e-mail de convite de funcionário (MOD-FUNC / MOD-AUTH-06). Fica no
 * módulo, não em `shared/`: é conteúdo de domínio, não infraestrutura — o
 * `shared/mailer.ts` só sabe entregar.
 *
 * HTML de e-mail é hostil: nada de CSS externo, flex/grid ou <style> — clientes
 * como o Outlook ignoram. Por isso o estilo é inline e o layout é uma tabela.
 */

export interface InviteEmailInput {
  /** Nome da imobiliária (tenant) — quem está convidando. */
  tenantName: string;
  /** Nome do convidado. */
  memberName: string;
  /** Link do ticket de aceite emitido pelo Clerk. */
  acceptUrl: string;
}

const escapeHtml = (v: string): string =>
  v.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

export function inviteSubject(tenantName: string): string {
  return `Seu acesso à ${tenantName} na Offices AI`;
}

export function inviteText(input: InviteEmailInput): string {
  return [
    `Olá, ${input.memberName}.`,
    "",
    `Você foi cadastrado como membro da equipe da ${input.tenantName} na Offices AI.`,
    "Para criar seu acesso, abra o link abaixo:",
    "",
    input.acceptUrl,
    "",
    "O convite expira em 30 dias. Se você não esperava este e-mail, ignore-o.",
  ].join("\n");
}

export function inviteHtml(input: InviteEmailInput): string {
  const name = escapeHtml(input.memberName);
  const tenant = escapeHtml(input.tenantName);
  // O href NÃO passa por escapeHtml de texto: é uma URL emitida pelo Clerk e o
  // escape de aspas já basta para não quebrar o atributo.
  const url = input.acceptUrl.replace(/"/g, "&quot;");

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;color:#1f2430;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;">
      <tr>
        <td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:18px;font-weight:600;">Olá, ${name}.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
            Você foi cadastrado como membro da equipe da <strong>${tenant}</strong> na Offices AI.
            Para criar seu acesso, clique no botão abaixo.
          </p>
          <p style="margin:0 0 24px;">
            <a href="${url}" style="display:inline-block;padding:12px 22px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
              Criar meu acesso
            </a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#5b6472;line-height:1.6;">
            Se o botão não funcionar, copie e cole este endereço no navegador:
          </p>
          <p style="margin:0 0 24px;font-size:12px;color:#5b6472;word-break:break-all;">${url}</p>
          <p style="margin:0;font-size:12px;color:#8a93a3;line-height:1.6;">
            O convite expira em 30 dias. Se você não esperava este e-mail, pode ignorá-lo.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
