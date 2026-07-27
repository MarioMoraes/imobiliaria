import * as personService from "../../person/person.service.js";
import type { ToolDefinition } from "./registry.js";

/**
 * Busca no cadastro unificado de pessoas (locador/locatário/fiador/comprador).
 *
 * Exige `person:read` — que o CORRETOR tem e o FINANCEIRO não. É o caso que
 * demonstra o gate do registry funcionando: o mesmo copiloto, perguntado por
 * dois papéis diferentes, responde coisas diferentes sobre pessoas.
 */
export const searchPersonsTool: ToolDefinition = {
  name: "buscar_pessoas",
  description:
    "Busca pessoas do cadastro por nome, documento, e-mail ou telefone. " +
    "Use apenas quando a pergunta já trouxer a pessoa (um nome, um CPF, um telefone); " +
    "para imóveis prefira as ferramentas de imóvel. " +
    "NÃO use para descobrir quem é o proprietário, o fiador ou o corretor de um imóvel — " +
    "esse vínculo não é revelado pelo assistente.",
  requires: "person:read",
  inputSchema: {
    type: "object",
    properties: {
      termo: { type: "string", description: "Nome, CPF/CNPJ, e-mail ou telefone." },
      limite: {
        type: "integer",
        description: "Quantidade máxima de pessoas a retornar (padrão 5, máximo 15).",
      },
    },
    required: ["termo"],
    additionalProperties: false,
  },
  async execute(ctx, input) {
    const termo = String(input.termo ?? "").trim();
    if (!termo) return "Nenhum termo de busca informado.";

    const limite = Math.min(Math.max(Number(input.limite) || 5, 1), 15);
    const persons = await personService.search(ctx.tenantId, termo, limite);

    if (persons.length === 0) return `Nenhuma pessoa encontrada para "${termo}".`;

    return persons
      .map((p) => {
        const roles = p.roles.length > 0 ? p.roles.join(", ") : "sem papel definido";
        const contato =
          [p.email, p.phone, p.mobile].filter(Boolean).join(" / ") || "sem contato cadastrado";
        return `[id: ${p.id}] ${p.fullName} — ${roles}. Contato: ${contato}.`;
      })
      .join("\n");
  },
};
