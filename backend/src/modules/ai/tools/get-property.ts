import * as propertyService from "../../property/property.service.js";
import { renderPropertyDocument } from "../rag/document.js";
import type { ToolDefinition } from "./registry.js";

/**
 * Ficha completa de um imóvel pelo id. O RAG devolve o texto que estava
 * indexado — que pode ter minutos de idade se o consumidor de eventos estiver
 * atrasado. Quando o agente vai afirmar um valor ou a disponibilidade, esta
 * ferramenta lê a linha atual do banco.
 */
export const getPropertyTool: ToolDefinition = {
  name: "detalhar_imovel",
  description:
    "Retorna a ficha atualizada de um imóvel específico pelo seu id. " +
    "Use antes de afirmar valores, disponibilidade ou condições — os resultados de busca podem estar desatualizados.",
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
    if (!id) return "Nenhum id informado.";

    // `getById` lança 404 quando não existe; o registry converte em texto para o
    // modelo, que aí explica que o imóvel não foi encontrado.
    const property = await propertyService.getById(ctx.tenantId, id);
    const owners = property.owners.length;

    return [
      `[id: ${property.id}] ${renderPropertyDocument(property)}`,
      // Contagem, não nomes: quem pergunta pode ter `property:read` sem ter
      // `person:read`, e o nome do proprietário é dado de pessoa.
      `Proprietários cadastrados: ${owners}.`,
    ].join(" ");
  },
};
