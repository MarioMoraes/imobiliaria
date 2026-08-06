import { auth } from "@clerk/nextjs/server";
import { fetchSaleAuthorization } from "../../../../../lib/api";

/**
 * Serve a Autorização de Venda (PDF) ao navegador.
 *
 * Mesmo padrão do contrato de administração (`[id]/contrato-administracao/route.ts`),
 * sem a etapa das testemunhas: o botão do cadastro é um `<a target="_blank">`
 * direto, e o PDF abre no visualizador nativo.
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
  const upstream = await fetchSaleAuthorization(id).catch(() => null);

  if (!upstream || !upstream.ok) {
    // O corpo de erro do backend é JSON (`{ error: { message } }`) — mostrar a
    // mensagem dele evita uma aba em branco sem explicação (é por aqui que
    // aparece o "nenhum modelo de autorização de venda cadastrado").
    const detail = await upstream?.json().catch(() => null);
    const message =
      (detail as { error?: { message?: string } } | null)?.error?.message ??
      "Não foi possível gerar a autorização de venda.";
    return new Response(message, {
      status: upstream?.status ?? 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      // O nome real vem do backend; aqui basta um fallback estável.
      "Content-Disposition": `inline; filename="autorizacao-venda.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
