import * as propertyService from "../../property/property.service.js";
import { renderPropertyDocument } from "../rag/document.js";
import type { ToolDefinition } from "./registry.js";

/**
 * Busca de imóveis por texto. Complementa o RAG em vez de substituí-lo: o RAG
 * traz o que é semanticamente parecido com a pergunta, esta ferramenta atende
 * quando o agente quer procurar um termo exato ("rua Sete de Setembro") ou
 * conferir um resultado.
 *
 * Chama o `service` de MOD-IMOVEL, nunca o repositório dele — é a regra de
 * fronteira de modules/README.md, a mesma que o módulo `search` já segue.
 */
export const searchPropertiesTool: ToolDefinition = {
  name: "buscar_imoveis",
  description:
    "Busca imóveis do cadastro da imobiliária por texto livre (título, endereço, bairro, cidade ou código). " +
    "Use quando precisar localizar imóveis específicos ou confirmar detalhes. " +
    "Retorna a descrição completa de cada imóvel encontrado.",
  requires: "property:read",
  inputSchema: {
    type: "object",
    properties: {
      termo: {
        type: "string",
        description: "Texto a procurar — bairro, cidade, rua, título ou código do imóvel.",
      },
      limite: {
        type: "integer",
        description: "Quantidade máxima de imóveis a retornar (padrão 5, máximo 15).",
      },
    },
    required: ["termo"],
    additionalProperties: false,
  },
  async execute(ctx, input) {
    const termo = String(input.termo ?? "").trim();
    if (!termo) return "Nenhum termo de busca informado.";

    const limite = Math.min(Math.max(Number(input.limite) || 5, 1), 15);
    const properties = await propertyService.search(ctx.tenantId, termo, limite);

    if (properties.length === 0) {
      return `Nenhum imóvel encontrado para "${termo}".`;
    }

    // Uma contagem para o lote todo — o resultado tem no máximo 15 imóveis.
    const photos = await propertyService.countPhotos(
      ctx.tenantId,
      properties.map((p) => p.id),
    );

    // Reusa o mesmo renderizador do índice: o modelo vê o imóvel descrito da
    // mesma forma venha ele do RAG ou da busca, sem dois vocabulários.
    return properties
      .map((p) => `[id: ${p.id}] ${renderPropertyDocument(p, photos.get(p.id) ?? 0)}`)
      .join("\n\n");
  },
};
