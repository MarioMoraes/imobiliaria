import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  addPartySchema,
  administrationWitnessesSchema,
  createContractSchema,
  createContractTemplateSchema,
  previewTemplateSchema,
  updateContractSchema,
  updateContractTemplateSchema,
} from "./contract.schema.js";
import { MERGE_FIELDS } from "./merge-fields.js";
import * as service from "./contract.service.js";

/**
 * Rotas de contratos. Montadas sob /v1/contracts (ver gateway/routes.ts), já
 * dentro do escopo autenticado. RBAC por rota via `requirePermission`.
 */
export async function contractRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("contract:read") }, async () => {
    return { data: await service.list(getTenantId()) };
  });

  app.get("/:id", { preHandler: requirePermission("contract:read") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.getById(getTenantId(), id) };
  });

  app.post("/", { preHandler: requirePermission("contract:write") }, async (req, reply) => {
    const parsed = createContractSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do contrato inválidos", parsed.error.flatten());
    }
    const contract = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: contract };
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("contract:write") },
    async (req) => {
      const parsed = updateContractSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Atualização do contrato inválida", parsed.error.flatten());
      }
      return { data: await service.update(getTenantId(), req.params.id, parsed.data) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("contract:delete") },
    async (req) => {
      await service.remove(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );

  // ── Partes (locador/locatário/fiador) ────────────────────────────
  app.get("/:id/parties", { preHandler: requirePermission("contract:read") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.listParties(getTenantId(), id) };
  });

  app.post("/:id/parties", { preHandler: requirePermission("contract:write") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = addPartySchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Parte do contrato inválida", parsed.error.flatten());
    }
    const contract = await service.addParty(getTenantId(), id, parsed.data.role, parsed.data.personId);
    reply.code(201);
    return { data: contract };
  });

  app.delete(
    "/:id/parties/:partyId",
    { preHandler: requirePermission("contract:write") },
    async (req) => {
      const { id, partyId } = req.params as { id: string; partyId: string };
      return { data: await service.removeParty(getTenantId(), id, partyId) };
    },
  );

  // ── Documento (PDF via Gotenberg) ────────────────────────────────
  app.post("/:id/generate", { preHandler: requirePermission("contract:write") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.generateDocument(getTenantId(), id) };
  });

  // Regera os aluguéis de um contrato já vigente (idempotente) — serve para o
  // contrato assinado antes de o valor/prazo estarem preenchidos.
  app.post("/:id/receivables", { preHandler: requirePermission("contract:write") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.generateReceivables(getTenantId(), id) };
  });

  app.get("/:id/pdf", { preHandler: requirePermission("contract:read") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: { url: await service.getPdfUrl(getTenantId(), id) } };
  });
}

/**
 * Documentos de contrato emitidos a partir do IMÓVEL. Montadas sob
 * /v1/properties (ver gateway/routes.ts), ao lado das rotas de imóvel e de
 * vistoria — os paths não colidem. Ficam no módulo de contrato porque quem sabe
 * montar um documento a partir de um modelo é ele; o módulo de imóvel não
 * conhece contrato (e o inverso já é a direção da dependência).
 */
export async function propertyContractRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Contrato de administração do imóvel em PDF. Responde os BYTES
   * (application/pdf), como o laudo de vistoria — quem chama abre/imprime.
   *
   * GET com as testemunhas na query: assim o botão do popup é um
   * `<a target="_blank">` comum, sem esbarrar no bloqueador de pop-up.
   */
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    "/:id/administration-contract",
    { preHandler: requirePermission("contract:read") },
    async (req, reply) => {
      const parsed = administrationWitnessesSchema.safeParse(req.query);
      if (!parsed.success) {
        throw AppError.badRequest(
          "Informe o nome das duas testemunhas.",
          parsed.error.flatten(),
        );
      }

      const { pdf, fileName } = await service.generateAdministrationDocument(
        getTenantId(),
        req.params.id,
        { first: parsed.data.testemunha1, second: parsed.data.testemunha2 },
      );

      reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `inline; filename="${fileName}"`);
      return reply.send(pdf);
    },
  );

  /**
   * Documentos de venda do imóvel: Autorização de Venda e Compromisso de Compra
   * e Venda. Também respondem os BYTES, mas sem query nenhuma — não há
   * testemunhas a informar, o botão do cadastro é um `<a>` direto.
   */
  const saleDocuments = [
    { path: "/:id/sale-authorization", generate: service.generateSaleAuthorizationDocument },
    { path: "/:id/purchase-commitment", generate: service.generatePurchaseCommitmentDocument },
  ] as const;

  for (const doc of saleDocuments) {
    app.get<{ Params: { id: string } }>(
      doc.path,
      { preHandler: requirePermission("contract:read") },
      async (req, reply) => {
        const { pdf, fileName } = await doc.generate(getTenantId(), req.params.id);

        reply
          .header("Content-Type", "application/pdf")
          .header("Content-Disposition", `inline; filename="${fileName}"`);
        return reply.send(pdf);
      },
    );
  }
}

/**
 * Templates de contrato (CRUD). Montado em /v1/contract-templates.
 * `?all=true` inclui os inativos — usado pela tela de manutenção em "Tabelas".
 */
export async function contractTemplateRoutes(app: FastifyInstance): Promise<void> {
  // Catálogo de variáveis dinâmicas — estático, não depende do tenant. Vem
  // antes de "/:id" para não ser capturado pela rota paramétrica.
  app.get("/merge-fields", { preHandler: requirePermission("contract:read") }, async () => {
    return { data: MERGE_FIELDS };
  });

  app.get<{ Querystring: { all?: string } }>(
    "/",
    { preHandler: requirePermission("contract:read") },
    async (req) => {
      const includeInactive = req.query.all === "true" || req.query.all === "1";
      return { data: await service.listTemplates(getTenantId(), includeInactive) };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("contract:read") },
    async (req) => {
      return { data: await service.getTemplate(getTenantId(), req.params.id) };
    },
  );

  // Pré-visualização: devolve o HTML final (com valores de exemplo) do conteúdo
  // ainda não salvo, para o editor mostrar exatamente o que virá no PDF.
  app.post("/preview", { preHandler: requirePermission("contract:read") }, async (req) => {
    const parsed = previewTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Conteúdo inválido para pré-visualização", parsed.error.flatten());
    }
    return { data: { html: service.previewTemplate(parsed.data.content) } };
  });

  app.post("/", { preHandler: requirePermission("contract:write") }, async (req, reply) => {
    const parsed = createContractTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do modelo inválidos", parsed.error.flatten());
    }
    const created = await service.createTemplate(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("contract:write") },
    async (req) => {
      const parsed = updateContractTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Atualização do modelo inválida", parsed.error.flatten());
      }
      return { data: await service.updateTemplate(getTenantId(), req.params.id, parsed.data) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("contract:delete") },
    async (req) => {
      await service.removeTemplate(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );
}
