import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";
import { requirePermission } from "../rbac/authorize.js";
import {
  savePaymentSettingsSchema,
  webhookPayloadSchema,
  WEBHOOK_TOKEN_HEADER,
} from "./payment.schema.js";
import * as service from "./payment.service.js";

/**
 * Ações de cobrança de uma parcela. Montado em /v1/receivables — não colide com
 * `receivableRoutes` porque os paths são distintos (boleto, sync-charge).
 */
export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  // Emite (ou recupera) a cobrança e devolve o link para abrir/imprimir.
  app.post<{ Params: { id: string } }>(
    "/:id/boleto",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      return { data: await service.issueCharge(getTenantId(), req.params.id) };
    },
  );

  // Caminho manual para desenvolvimento, onde o webhook não chega.
  app.post<{ Params: { id: string } }>(
    "/:id/sync-charge",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      await service.syncCharge(getTenantId(), req.params.id);
      return { data: { synced: true } };
    },
  );
}

/**
 * Configuração da integração por tenant. Montado em /v1/payment-settings.
 * A chave da API nunca é devolvida — só o hint dos últimos caracteres.
 */
export async function paymentSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requirePermission("tenant:config:read") }, async () => {
    return { data: await service.getSettings(getTenantId()) };
  });

  app.put("/", { preHandler: requirePermission("tenant:config:write") }, async (req) => {
    const parsed = savePaymentSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Configuração de cobrança inválida", parsed.error.flatten());
    }
    return { data: await service.saveSettings(getTenantId(), parsed.data) };
  });

  app.delete("/", { preHandler: requirePermission("tenant:config:write") }, async () => {
    await service.disconnect(getTenantId());
    return { data: { disconnected: true } };
  });
}

/**
 * Callback do Asaas — PÚBLICO, fora de /v1: o provedor não manda `x-tenant-id`
 * nem token de sessão. O tenant vem da URL (cada conta Asaas registra a sua) e a
 * autenticidade vem do `authToken` que devolvemos no header — o Asaas não
 * assina os callbacks (não há HMAC).
 */
export async function paymentWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { tenantId: string } }>("/:tenantId", async (req) => {
    const parsed = webhookPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      // 200 de propósito: payload que não entendemos não deve ser reenfileirado
      // (o Asaas interrompe a fila inteira do tenant após falhas seguidas).
      logger.warn({ body: req.body }, "webhook do Asaas com payload inesperado");
      return { data: { ignored: true } };
    }

    const token = req.headers[WEBHOOK_TOKEN_HEADER];
    const ok = await service.handleWebhook(
      req.params.tenantId,
      typeof token === "string" ? token : undefined,
      parsed.data,
    );

    if (!ok) {
      // Mesma resposta para tenant inexistente e token errado (não confirma a
      // existência do tenant para quem estiver sondando).
      throw new AppError("UNAUTHORIZED", 401, "Token do webhook inválido");
    }

    return { data: { received: true } };
  });
}
