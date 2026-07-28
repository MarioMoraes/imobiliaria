import { fetchPayoutReport } from "../../../../../lib/api";

/**
 * Serve o Relatório de Repasses (PDF) ao navegador.
 *
 * É um Route Handler, e não uma Server Action, porque o resultado é um ARQUIVO:
 * assim o botão é um `<a target="_blank">` comum e o PDF abre no visualizador
 * nativo (imprimir, salvar). Por Server Action seria preciso trafegar o binário
 * em base64 e abrir a aba antes do `await` para escapar do bloqueador de pop-up.
 *
 * O proxy existe pela autenticação: o backend exige o token do Clerk, que só o
 * servidor tem — o navegador não pode chamar `/v1/payables/report` direto.
 */
export async function GET(request: Request): Promise<Response> {
  const month = new URL(request.url).searchParams.get("mes") ?? "";
  const competence = /^\d{4}-\d{2}$/.test(month)
    ? month
    : new Date().toISOString().slice(0, 7);

  const upstream = await fetchPayoutReport(competence).catch(() => null);

  if (!upstream || !upstream.ok) {
    // O corpo de erro do backend é JSON no formato `{ error: { message } }` —
    // mostrar a mensagem dele evita uma aba em branco sem explicação.
    const detail = await upstream?.json().catch(() => null);
    const message =
      (detail as { error?: { message?: string } } | null)?.error?.message ??
      "Não foi possível gerar o relatório.";
    return new Response(message, {
      status: upstream?.status ?? 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="repasses-${competence}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
