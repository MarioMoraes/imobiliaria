import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  addOwnerSchema,
  addPhotoSchema,
  createPropertySchema,
  updatePropertySchema,
} from "./property.schema.js";
import * as service from "./property.service.js";

/**
 * Rotas de imóveis. Montadas sob /v1/properties (ver gateway/routes.ts), já
 * dentro do escopo autenticado (authContextHook). O RBAC é aplicado por rota
 * via `requirePermission` (MOD-AUTH-03).
 */
export async function propertyRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { condominiumId?: string } }>(
    "/",
    { preHandler: requirePermission("property:read") },
    async (req) => {
      const { condominiumId } = req.query;
      const tenantId = getTenantId();
      const data = condominiumId
        ? await service.listByCondominium(tenantId, condominiumId)
        : await service.list(tenantId);
      return { data };
    },
  );

  /**
   * Relatório de Imóveis a Alugar em PDF. Responde os BYTES (application/pdf),
   * e não o envelope `{ data }` das demais rotas — quem chama abre/imprime o
   * arquivo. Dois segmentos (`/report/rental`) para não disputar com `/:id`.
   */
  app.get("/report/rental", { preHandler: requirePermission("property:read") }, async (_req, reply) => {
    const { pdf, fileName } = await service.rentalReport(getTenantId());

    // `inline` abre no visualizador do navegador; o nome é o que o "salvar
    // como" sugere — sem ele o arquivo herdaria o nome da rota ("rental.pdf").
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="${fileName}"`);
    return reply.send(pdf);
  });

  app.get("/:id", { preHandler: requirePermission("property:read") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.getById(getTenantId(), id) };
  });

  app.post("/", { preHandler: requirePermission("property:write") }, async (req, reply) => {
    const parsed = createPropertySchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados do imóvel inválidos", parsed.error.flatten());
    }
    const property = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: property };
  });

  app.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("property:write") },
    async (req) => {
      const parsed = updatePropertySchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Atualização do imóvel inválida", parsed.error.flatten());
      }
      return { data: await service.update(getTenantId(), req.params.id, parsed.data) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("property:delete") },
    async (req) => {
      await service.remove(getTenantId(), req.params.id);
      return { data: { deleted: true } };
    },
  );

  // ── Donos (proprietários) do imóvel ──────────────────────────────
  app.get("/:id/owners", { preHandler: requirePermission("property:read") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.listOwners(getTenantId(), id) };
  });

  app.post("/:id/owners", { preHandler: requirePermission("property:write") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = addOwnerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Vínculo de dono inválido", parsed.error.flatten());
    }
    const property = await service.addOwner(getTenantId(), id, parsed.data.personId, parsed.data.sharePercent);
    reply.code(201);
    return { data: property };
  });

  app.delete(
    "/:id/owners/:personId",
    { preHandler: requirePermission("property:write") },
    async (req) => {
      const { id, personId } = req.params as { id: string; personId: string };
      return { data: await service.removeOwner(getTenantId(), id, personId) };
    },
  );

  // ── Fotos do imóvel ──────────────────────────────────────────────
  app.get("/:id/photos", { preHandler: requirePermission("property:read") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.listPhotos(getTenantId(), id) };
  });

  app.post("/:id/photos", { preHandler: requirePermission("property:write") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = addPhotoSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Foto inválida", parsed.error.flatten());
    }
    const photo = await service.addPhoto(getTenantId(), id, parsed.data);
    reply.code(201);
    return { data: photo };
  });

  app.delete(
    "/:id/photos/:photoId",
    { preHandler: requirePermission("property:write") },
    async (req) => {
      const { id, photoId } = req.params as { id: string; photoId: string };
      await service.removePhoto(getTenantId(), id, photoId);
      return { data: { deleted: true } };
    },
  );
}
