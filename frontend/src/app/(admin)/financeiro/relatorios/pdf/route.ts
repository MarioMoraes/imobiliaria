import { auth } from "@clerk/nextjs/server";
import { FINANCE_REPORTS, fetchFinanceReport, type FinanceReportKind } from "../../../../../lib/api";

/**
 * Serve os quatro relatórios do financeiro (PDF) ao navegador.
 *
 * É um Route Handler, e não uma Server Action, porque o resultado é um ARQUIVO:
 * assim o botão do popup é um `<a target="_blank">` comum e o PDF abre no
 * visualizador nativo (imprimir, salvar). Por Server Action seria preciso
 * trafegar o binário em base64 e abrir a aba antes do `await` para escapar do
 * bloqueador de pop-up. Mesmo desenho de `proprietarios/relatorio/route.ts`.
 *
 * Um handler para os quatro, e não quatro arquivos: o que muda entre eles é uma
 * URL no backend — o gate de sessão, a validação do período e a tradução do erro
 * são idênticos, e duplicá-los garantiria que só três ficassem corrigidos na
 * próxima mudança.
 */
export async function GET(request: Request): Promise<Response> {
  // Route Handler não roda o layout de `(admin)/`, então o gate de sessão é
  // repetido aqui. 401 (e não redirect): a resposta é um arquivo, quem chama é
  // um `<a>`, e mandar o HTML do login viraria um PDF corrompido.
  const { userId } = await auth();
  if (!userId) {
    return text("Sessão expirada. Faça login novamente.", 401);
  }

  const params = new URL(request.url).searchParams;
  const kind = params.get("tipo") ?? "";
  const from = params.get("de") ?? "";
  const to = params.get("ate") ?? "";

  if (!(kind in FINANCE_REPORTS)) {
    return text("Relatório desconhecido.", 400);
  }
  if (!isDay(from) || !isDay(to)) {
    return text("Informe o período no formato AAAA-MM-DD.", 400);
  }
  if (from > to) {
    return text("A data inicial não pode ser maior que a final.", 400);
  }

  const upstream = await fetchFinanceReport(kind as FinanceReportKind, from, to).catch(
    () => null,
  );

  if (!upstream || !upstream.ok) {
    // O corpo de erro do backend é JSON no formato `{ error: { message } }` —
    // mostrar a mensagem dele evita uma aba em branco sem explicação.
    const detail = await upstream?.json().catch(() => null);
    const message =
      (detail as { error?: { message?: string } } | null)?.error?.message ??
      "Não foi possível gerar o relatório.";
    return text(message, upstream?.status ?? 502);
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${kind}-${from}-a-${to}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
