import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";
import { isUuid } from "../../shared/uuid.js";
import { requirePermission } from "../rbac/authorize.js";
import { record } from "../audit/audit.service.js";
import {
  saveSettingsSchema,
  webhookPayloadSchema,
  WEBHOOK_SECRET_HEADER,
} from "./signature.schema.js";
import * as service from "./signature.service.js";

/**
 * Ações de assinatura de um contrato. Montado em /v1/contracts — não colide com
 * `contractRoutes` porque os paths são distintos (send-to-sign, signature…).
 */
export async function signatureRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    "/:id/send-to-sign",
    { preHandler: requirePermission("contract:write") },
    async (req, reply) => {
      const envelope = await service.sendToSign(getTenantId(), req.params.id);
      reply.code(201);
      return { data: envelope };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/sync-signature",
    { preHandler: requirePermission("contract:write") },
    async (req) => {
      return { data: await service.syncFromProvider(getTenantId(), req.params.id) };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/:id/signature",
    { preHandler: requirePermission("contract:read") },
    async (req) => {
      return { data: await service.getEnvelope(getTenantId(), req.params.id) };
    },
  );
}

/**
 * Configuração da integração por tenant. Montado em /v1/signature-settings.
 * O token da API nunca é devolvido — só o hint dos últimos caracteres.
 */
export async function signatureSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("tenant:config:read") }, async () => {
    return { data: await service.getSettings(getTenantId()) };
  });

  app.put("/", { preHandler: requirePermission("tenant:config:write") }, async (req) => {
    const parsed = saveSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Configuração de assinatura inválida", parsed.error.flatten());
    }
    return { data: await service.saveSettings(getTenantId(), parsed.data) };
  });

  app.delete("/", { preHandler: requirePermission("tenant:config:write") }, async () => {
    await service.disconnect(getTenantId());
    return { data: { disconnected: true } };
  });
}

/**
 * Callback da ZapSign — PÚBLICO, fora de /v1: o provedor não manda `x-tenant-id`
 * nem token de sessão. O tenant vem da URL (cada conta ZapSign registra a sua) e
 * a autenticidade vem do header secreto que nós mesmos configuramos no registro
 * do webhook — a ZapSign não assina os callbacks (não há HMAC).
 */
export async function signatureWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { tenantId: string } }>(
    "/:tenantId",
    {
      // Mesmo raciocínio do webhook do Asaas: público, credencial única é o
      // segredo por tenant, então precisa de teto de tentativas.
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (req) => {
      const parsed = webhookPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        // 200 de propósito: payload que não entendemos não deve ser reenfileirado.
        logger.warn({ body: req.body }, "webhook da ZapSign com payload inesperado");
        return { data: { ignored: true } };
      }

      const secret = req.headers[WEBHOOK_SECRET_HEADER];
      // Mesmo motivo do webhook do Asaas: `tenantId` da URL entra no `set_config`
      // antes de qualquer autenticação, e um id malformado viraria 500 público.
      const ok =
        isUuid(req.params.tenantId) &&
        (await service.handleWebhook(
          req.params.tenantId,
          typeof secret === "string" ? secret : undefined,
          parsed.data.token,
        ));

      if (!ok) {
        // Mesma resposta para tenant inexistente e segredo errado (não confirma
        // a existência do tenant para quem estiver sondando).
        throw new AppError("UNAUTHORIZED", 401, "Assinatura do webhook inválida");
      }

      // Auditoria explícita: o callback chega fora de /v1, sem sessão. A
      // assinatura tem valor legal (PRD 08), então o registro é do provedor.
      await record({
        tenantId: req.params.tenantId,
        action: "webhook.processed",
        entity: "contract",
        entityId: parsed.data.external_id ?? null,
        actorLabel: "ZapSign (webhook)",
        payload: { event: parsed.data.event_type, status: parsed.data.status },
        ipAddress: req.ip,
      });

      return { data: { received: true } };
    },
  );
}
