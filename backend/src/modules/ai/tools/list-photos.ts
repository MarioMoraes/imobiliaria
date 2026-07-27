import * as propertyService from "../../property/property.service.js";
import type { ToolDefinition } from "./registry.js";

/**
 * Mostra as fotos de um imóvel no chat.
 *
 * É a única ferramenta que produz algo além de texto: além de responder ao
 * modelo, ela empurra as imagens para `ctx.attach`, e a interface as renderiza
 * abaixo da resposta (ver ChatAttachment em ai.schema.ts).
 *
 * O texto devolvido ao modelo traz as legendas, mas NUNCA as URLs. Duas razões:
 * uma URL presignada custa ~150 tokens e não acrescenta nada ao raciocínio, e
 * se ela entrar no contexto o modelo tende a colá-la na resposta — em uma
 * interface que mostra texto puro, isso vira lixo na tela.
 */
export const listPhotosTool: ToolDefinition = {
  name: "mostrar_fotos_imovel",
  description:
    "Mostra ao usuário as fotos cadastradas de um imóvel, pelo id. " +
    "Use sempre que pedirem fotos, imagens ou 'como é' um imóvel. " +
    "As imagens aparecem automaticamente na tela do usuário — você só precisa anunciá-las em uma frase.",
  requires: "property:read",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "id (UUID) do imóvel." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  async execute(ctx, input) {
    const id = String(input.id ?? "").trim();
    if (!id) return "Nenhum id de imóvel informado.";

    // Primeiro o imóvel: dá o 404 com mensagem boa e rende o rótulo da galeria.
    const property = await propertyService.getById(ctx.tenantId, id);
    const label = property.code ? `Imóvel ${property.code} — ${property.title}` : property.title;

    const photos = await propertyService.listPhotos(ctx.tenantId, id);
    if (photos.length === 0) {
      return `${label}: nenhuma foto cadastrada. Diga isso ao usuário; não descreva imagens que não existem.`;
    }

    for (const photo of photos) {
      ctx.attach({ kind: "photo", url: photo.url, caption: photo.caption, source: label });
    }

    const legendas = photos
      .map((p, i) => `${i + 1}. ${p.caption ?? "sem legenda"}`)
      .join("; ");

    return (
      `${photos.length} foto(s) de "${label}" já foram exibidas na tela do usuário. ` +
      `Legendas: ${legendas}. ` +
      `Apenas confirme em uma frase o que está sendo mostrado — não repita as legendas uma a uma ` +
      `nem escreva links.`
    );
  },
};
