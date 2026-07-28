import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import { saveInspectionSchema } from "./inspection.schema.js";
import * as service from "./inspection.service.js";

/**
 * Vistoria do imóvel. Montadas sob /v1/properties (ver gateway/routes.ts) —
 * o mesmo prefixo do módulo `property`, como `signature` faz com `contracts`.
 * Os paths não colidem: aqui tudo pende de `/:id/inspection`.
 *
 * Reaproveita as permissões de imóvel (`property:read`/`property:write`): a
 * vistoria é um atributo do imóvel, quem edita um edita a outra.
 */
export async function inspectionRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/:id/inspection",
    { preHandler: requirePermission("property:read") },
    async (req) => {
      return { data: await service.getByProperty(getTenantId(), req.params.id) };
    },
  );

  app.put<{ Params: { id: string } }>(
    "/:id/inspection",
    { preHandler: requirePermission("property:write") },
    async (req) => {
      const parsed = saveInspectionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Dados da vistoria inválidos", parsed.error.flatten());
      }
      return { data: await service.save(getTenantId(), req.params.id, parsed.data) };
    },
  );

  /**
   * Laudo em PDF. Responde os BYTES (application/pdf), e não o envelope
   * `{ data }` das demais rotas — quem chama abre/imprime o arquivo.
   */
  app.get<{ Params: { id: string } }>(
    "/:id/inspection/report",
    { preHandler: requirePermission("property:read") },
    async (req, reply) => {
      const { pdf, fileName } = await service.report(getTenantId(), req.params.id);

      // `inline` abre no visualizador do navegador; o nome é o que o "salvar
      // como" sugere — sem ele o arquivo herdaria o nome da rota ("report.pdf").
      reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `inline; filename="${fileName}"`);
      return reply.send(pdf);
    },
  );
}
