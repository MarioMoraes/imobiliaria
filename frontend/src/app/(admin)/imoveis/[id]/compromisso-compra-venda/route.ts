import { auth } from "@clerk/nextjs/server";
import { fetchPurchaseCommitment } from "../../../../../lib/api";

/**
 * Serve o Compromisso de Compra e Venda (PDF) ao navegador.
 *
 * Irmão de `[id]/autorizacao-venda/route.ts`. O documento sai preenchido com o
 * comprador quando a venda já foi registrada, e em branco quando não — quem
 * decide isso é o backend, aqui só passa o arquivo adiante.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Route Handler não roda o layout de `(admin)/`: o gate de sessão é repetido
  // aqui, com 401 em texto puro (o HTML do login viraria um PDF corrompido).
  const { userId } = await auth();
  if (!userId) {
    return new Response("Sessão expirada. Faça login novamente.", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const { id } = await params;
  const upstream = await fetchPurchaseCommitment(id).catch(() => null);

  if (!upstream || !upstream.ok) {
    const detail = await upstream?.json().catch(() => null);
    const message =
      (detail as { error?: { message?: string } } | null)?.error?.message ??
      "Não foi possível gerar o compromisso de compra e venda.";
    return new Response(message, {
      status: upstream?.status ?? 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="compromisso-compra-venda.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
