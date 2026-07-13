import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  addInteractionSchema,
  createPersonSchema,
  personAddressSchema,
  searchProfileInput,
  updatePersonSchema,
} from "./person.schema.js";
import * as service from "./person.service.js";

/**
 * Pessoas (MOD-PESSOA). Montadas sob /v1/persons (escopo tenant + RBAC).
 * Leitura: ADMIN/GESTOR/CORRETOR; escrita: idem + AI_AGENT; delete: ADMIN/GESTOR
 * (AI_AGENT nunca deleta — RN-04). `GET /?role=FIADOR` filtra por papel.
 */
export async function personRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("person:read") }, async (req) => {
    const q = req.query as { role?: string; stage?: string; broker?: string };
    return {
      data: await service.list(getTenantId(), {
        role: q.role,
        stage: q.stage,
        brokerId: q.broker,
      }),
    };
  });

  app.get("/:id", { preHandler: requirePermission("person:read") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.getById(getTenantId(), id) };
  });

  app.post("/", { preHandler: requirePermission("person:write") }, async (req, reply) => {
    const parsed = createPersonSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados da pessoa inválidos", parsed.error.flatten());
    }
    const created = await service.create(getTenantId(), parsed.data);
    reply.code(201);
    return { data: created };
  });

  app.patch("/:id", { preHandler: requirePermission("person:write") }, async (req) => {
    const { id } = req.params as { id: string };
    const parsed = updatePersonSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Atualização inválida", parsed.error.flatten());
    }
    return { data: await service.update(getTenantId(), id, parsed.data) };
  });

  app.post(
    "/:id/addresses",
    { preHandler: requirePermission("person:write") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = personAddressSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Endereço inválido", parsed.error.flatten());
      }
      const updated = await service.addAddress(getTenantId(), id, parsed.data);
      reply.code(201);
      return { data: updated };
    },
  );

  app.post(
    "/:id/search-profiles",
    { preHandler: requirePermission("person:write") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = searchProfileInput.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Perfil de busca inválido", parsed.error.flatten());
      }
      const updated = await service.addSearchProfile(getTenantId(), id, parsed.data);
      reply.code(201);
      return { data: updated };
    },
  );

  app.post(
    "/:id/interactions",
    { preHandler: requirePermission("person:write") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = addInteractionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.badRequest("Interação inválida", parsed.error.flatten());
      }
      const updated = await service.addInteraction(getTenantId(), id, parsed.data);
      reply.code(201);
      return { data: updated };
    },
  );

  app.delete("/:id", { preHandler: requirePermission("person:delete") }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await service.inactivate(getTenantId(), id) };
  });
}
