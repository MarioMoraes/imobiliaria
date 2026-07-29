import { auth } from "@clerk/nextjs/server";
import { fetchAdministrationContract } from "../../../../../lib/api";

/**
 * Serve o Contrato de Administração (PDF) ao navegador.
 *
 * Mesmo padrão do laudo de vistoria (`[id]/vistoria/route.ts`): Route Handler,
 * e não Server Action, porque o resultado é um ARQUIVO — o botão do popup é um
 * `<a target="_blank">` comum e o PDF abre no visualizador nativo, sem trafegar
 * binário em base64 nem esbarrar no bloqueador de pop-up.
 *
 * As testemunhas vêm na query porque são digitadas na hora da emissão: o link
 * só fica clicável depois que os dois nomes estão preenchidos.
 */
export async function GET(
  request: Request,
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
  const query = new URL(request.url).searchParams;
  const witnesses = {
    first: query.get("testemunha1")?.trim() ?? "",
    second: query.get("testemunha2")?.trim() ?? "",
  };

  if (!witnesses.first || !witnesses.second) {
    return new Response("Informe o nome das duas testemunhas.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const upstream = await fetchAdministrationContract(id, witnesses).catch(() => null);

  if (!upstream || !upstream.ok) {
    // O corpo de erro do backend é JSON (`{ error: { message } }`) — mostrar a
    // mensagem dele evita uma aba em branco sem explicação (é por aqui que
    // aparece o "nenhum modelo de administração cadastrado", por exemplo).
    const detail = await upstream?.json().catch(() => null);
    const message =
      (detail as { error?: { message?: string } } | null)?.error?.message ??
      "Não foi possível gerar o contrato de administração.";
    return new Response(message, {
      status: upstream?.status ?? 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      // O nome real vem do backend; aqui basta um fallback estável.
      "Content-Disposition": `inline; filename="contrato-administracao.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
