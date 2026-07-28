import { auth } from "@clerk/nextjs/server";
import { fetchInspectionReport } from "../../../../../lib/api";

/**
 * Serve o Laudo de Vistoria (PDF) ao navegador.
 *
 * Route Handler, e não Server Action, porque o resultado é um ARQUIVO: o botão
 * vira um `<a target="_blank">` comum e o PDF abre no visualizador nativo, sem
 * trafegar binário em base64 nem esbarrar no bloqueador de pop-up. Mesmo padrão
 * do relatório de repasses (`financeiro/proprietarios/relatorio/route.ts`).
 *
 * O proxy existe pela autenticação: o backend exige o token do Clerk, que só o
 * servidor tem.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Route Handler não roda o layout de `(admin)/`, então o gate de sessão é
  // repetido aqui. 401 (e não redirect): quem chama é um `<a>` esperando um
  // arquivo, e o HTML do login viraria um PDF corrompido no visualizador.
  const { userId } = await auth();
  if (!userId) {
    return new Response("Sessão expirada. Faça login novamente.", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const { id } = await params;
  const upstream = await fetchInspectionReport(id).catch(() => null);

  if (!upstream || !upstream.ok) {
    // O corpo de erro do backend é JSON no formato `{ error: { message } }` —
    // mostrar a mensagem dele evita uma aba em branco sem explicação (é por
    // aqui que aparece o "Gotenberg indisponível", por exemplo).
    const detail = await upstream?.json().catch(() => null);
    const message =
      (detail as { error?: { message?: string } } | null)?.error?.message ??
      "Não foi possível gerar o laudo de vistoria.";
    return new Response(message, {
      status: upstream?.status ?? 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      // O nome real vem do backend; aqui basta um fallback estável.
      "Content-Disposition": `inline; filename="vistoria.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
