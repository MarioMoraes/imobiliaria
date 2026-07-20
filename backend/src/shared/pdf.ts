import { env } from "../config/env.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";

/**
 * Conversão HTML → PDF via Gotenberg (MOD-CONTRATO — geração do documento do
 * contrato). Gotenberg é um serviço stateless que roda Chromium; enviamos o
 * HTML como um arquivo `index.html` no endpoint de conversão do Chromium.
 *
 * Diferente do barramento de eventos, aqui a falha NÃO é tolerável em silêncio:
 * quem chamou pediu um PDF. Traduzimos qualquer problema (serviço fora, timeout)
 * num AppError amigável para o usuário.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  // O nome do arquivo importa: o Chromium renderiza o `index.html`.
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  // Margens em polegadas (padrão de documento A4).
  form.append("marginTop", "0.6");
  form.append("marginBottom", "0.6");
  form.append("marginLeft", "0.6");
  form.append("marginRight", "0.6");

  let res: Response;
  try {
    res = await fetch(`${env.GOTENBERG_URL}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    logger.warn({ err }, "falha ao contatar o Gotenberg");
    throw new AppError(
      "INTERNAL",
      502,
      "Serviço de geração de PDF indisponível. Verifique se o Gotenberg está no ar (docker compose up -d gotenberg).",
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logger.warn({ status: res.status, detail }, "Gotenberg respondeu com erro");
    throw new AppError("INTERNAL", 502, "Falha ao gerar o PDF do contrato.");
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
