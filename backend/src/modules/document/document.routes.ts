import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  addVersionSchema,
  createDocumentSchema,
  listDocumentsQuery,
} from "./document.schema.js";
import * as service from "./document.service.js";

/**
 * Rotas do repositório documental. Montadas sob /v1/documents, dentro do escopo
 * autenticado. O download não passa por aqui: a listagem devolve a URL
 * presignada e o navegador vai direto ao bucket.
 */
export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("document:read") }, async (req) => {
    const parsed = listDocumentsQuery.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest("Filtro inválido", parsed.error.flatten());
    }
    return { data: await service.list(getTenantId(), parsed.data) };
  });

  /** Contadores da biblioteca (total, a vencer em 30 dias, vencidos). */
  app.get("/summary", { preHandler: requirePermission("document:read") }, async () => {
    return { data: await service.counts(getTenantId()) };
  });

  app.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("document:read") },
    async (req) => ({ data: await service.getById(getTenantId(), req.params.id) }),
  );

  app.get<{ Params: { id: string } }>(
    "/:id/versions",
    { preHandler: requirePermission("document:read") },
    async (req) => ({ data: await service.listVersions(getTenantId(), req.params.id) }),
  );

  app.post("/", { preHandler: requirePermission("document:write") }, async (req, reply) => {
    const parsed = createDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Documento inválido", parsed.error.flatten());
    }
    const document = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: document };
  });

  app.post<{ Params: { id: string } }>(
    "/:id/versions",
    { preHandler: requirePermission("document:write") },
    async (req, reply) => {
      const parsed = addVersionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Nova versão inválida", parsed.error.flatten());
      }
      const document = await service.addVersion(getTenantId(), req.params.id, parsed.data);
      reply.code(201);
      return { data: document };
    },
  );

  // Expurgo LGPD: irreversível (apaga o binário), por isso fica com ADMIN.
  app.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requirePermission("document:delete") },
    async (req) => {
      await service.purge(getTenantId(), req.params.id);
      return { data: { purged: true } };
    },
  );
}
