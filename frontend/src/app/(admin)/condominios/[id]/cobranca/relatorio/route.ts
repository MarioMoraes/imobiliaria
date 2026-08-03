import { auth } from "@clerk/nextjs/server";
import { fetchCondoBillingReport } from "../../../../../../lib/api";

/**
 * Serve o Relatório de Cobrança de Condomínio (PDF) ao navegador.
 *
 * É um Route Handler, e não uma Server Action, porque o resultado é um ARQUIVO:
 * assim o botão é um `<a target="_blank">` comum e o PDF abre no visualizador
 * nativo (imprimir, salvar). Por Server Action seria preciso trafegar o binário
 * em base64 e abrir a aba antes do `await` para escapar do bloqueador de pop-up.
 *
 * O proxy existe pela autenticação: o backend exige o token do Clerk, que só o
 * servidor tem — o navegador não pode chamar `/v1/condominiums/…` direto.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Route Handler não roda o layout de `(admin)/`, então o gate de sessão é
  // repetido aqui. 401 (e não redirect): a resposta é um arquivo, quem chama é
  // um `<a>`, e mandar o HTML do login viraria um PDF corrompido no visualizador.
  const { userId } = await auth();
  if (!userId) {
    return new Response("Sessão expirada. Faça login novamente.", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // O condomínio vem do caminho, como no resto da subárvore; só o período e o
  // vencimento andam na query.
  const { id: condominiumId } = await params;
  const query = new URL(request.url).searchParams;
  const periodStart = query.get("de") ?? "";
  const periodEnd = query.get("ate") ?? "";
  const dueDate = query.get("vencimento") ?? "";

  if (![periodStart, periodEnd, dueDate].every((d) => ISO_DATE.test(d))) {
    return new Response("Informe o período e o vencimento.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const upstream = await fetchCondoBillingReport(condominiumId, {
    periodStart,
    periodEnd,
    dueDate,
  }).catch(() => null);

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
      "Content-Disposition": `inline; filename="cobranca-condominio-${periodStart}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
