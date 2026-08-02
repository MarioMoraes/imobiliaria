import { auth } from "@clerk/nextjs/server";
import { fetchPayoutReceipt } from "../../../../../lib/api";

/**
 * Serve o Recibo de Repasse (PDF) ao navegador — mesmo desenho do relatório
 * (`../relatorio/route.ts`): Route Handler, e não Server Action, porque o
 * resultado é um ARQUIVO. Assim o botão é um `<a target="_blank">` e o PDF abre
 * no visualizador nativo, sem trafegar binário em base64 nem esbarrar no
 * bloqueador de pop-up.
 *
 * `?ids=a,b,c` — um recibo pode cobrir vários lançamentos do mesmo
 * proprietário. Quem valida (mesmo dono, todos pagos) é o backend.
 */
export async function GET(request: Request): Promise<Response> {
  // Route Handler não roda o layout de `(admin)/`, então o gate de sessão é
  // repetido aqui. 401 e não redirect: quem chama é um `<a>`, e o HTML do login
  // viraria um PDF corrompido no visualizador.
  const { userId } = await auth();
  if (!userId) {
    return new Response("Sessão expirada. Faça login novamente.", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!ids.length) {
    return new Response("Selecione o repasse do recibo.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const upstream = await fetchPayoutReceipt(ids).catch(() => null);

  if (!upstream || !upstream.ok) {
    // O erro do backend é JSON (`{ error: { message } }`) — mostrar a mensagem
    // dele evita uma aba em branco sem explicação ("repasse ainda não pago",
    // "proprietários diferentes").
    const detail = await upstream?.json().catch(() => null);
    const message =
      (detail as { error?: { message?: string } } | null)?.error?.message ??
      "Não foi possível gerar o recibo.";
    return new Response(message, {
      status: upstream?.status ?? 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recibo-repasse.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
