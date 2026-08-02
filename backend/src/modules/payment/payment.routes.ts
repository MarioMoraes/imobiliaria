import type { FastifyInstance } from "fastify";
import { getTenantId } from "../../shared/tenant-context.js";
import { AppError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";
import { isUuid } from "../../shared/uuid.js";
import { requirePermission } from "../rbac/authorize.js";
import { record } from "../audit/audit.service.js";
import { payableIdsSchema } from "../payable/payable.schema.js";
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
 * Ações de pagamento de um repasse. Montado em /v1/payables — não colide com
 * `payableRoutes` porque os paths são distintos (transfer, sync-transfer).
 */
export async function payoutRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Um PIX só para vários repasses do mesmo proprietário. Path estático, então
   * não colide com `POST /:id/transfer` nem com o `POST /` de `payableRoutes`.
   */
  app.post("/transfer-batch", { preHandler: requirePermission("finance:write") }, async (req) => {
    const parsed = payableIdsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Seleção inválida", parsed.error.flatten());
    }
    return { data: await service.transferPayouts(getTenantId(), parsed.data.payableIds) };
  });

  // Envia o repasse por PIX. É dinheiro SAINDO, então fica sob finance:write
  // (ADMIN/FINANCEIRO) como o resto da escrita financeira.
  app.post<{ Params: { id: string } }>(
    "/:id/transfer",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      return { data: await service.transferPayout(getTenantId(), req.params.id) };
    },
  );

  // Caminho manual para desenvolvimento, onde o webhook não chega — sem ele o
  // repasse ficaria PROCESSANDO para sempre.
  app.post<{ Params: { id: string } }>(
    "/:id/sync-transfer",
    { preHandler: requirePermission("finance:write") },
    async (req) => {
      await service.syncTransfer(getTenantId(), req.params.id);
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
  app.post<{ Params: { tenantId: string } }>(
    "/:tenantId",
    {
      // Endpoint público cuja única credencial é o token por tenant. Sem limite,
      // um atacante testaria segredos indefinidamente. O teto é generoso o
      // bastante para o volume real do Asaas (que reentrega em caso de falha).
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (req) => {
      const parsed = webhookPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        // 200 de propósito: payload que não entendemos não deve ser reenfileirado
        // (o Asaas interrompe a fila inteira do tenant após falhas seguidas).
        logger.warn({ body: req.body }, "webhook do Asaas com payload inesperado");
        return { data: { ignored: true } };
      }

      const token = req.headers[WEBHOOK_TOKEN_HEADER];
      // `tenantId` vem da URL e é usado antes de qualquer autenticação: sem
      // validar o formato, um id qualquer chegava ao `set_config` e só estourava
      // no cast `::uuid` da policy, virando 500 num endpoint público.
      const ok =
        isUuid(req.params.tenantId) &&
        (await service.handleWebhook(
          req.params.tenantId,
          typeof token === "string" ? token : undefined,
          parsed.data,
        ));

      if (!ok) {
        // Mesma resposta para tenant inexistente e token errado (não confirma a
        // existência do tenant para quem estiver sondando).
        throw new AppError("UNAUTHORIZED", 401, "Token do webhook inválido");
      }

      // Auditoria explícita (PRD 11): o webhook chega fora de /v1, sem sessão —
      // a captura automática do gateway não o enxerga. O ator é o provedor.
      await record({
        tenantId: req.params.tenantId,
        action: "webhook.processed",
        entity: parsed.data.transfer ? "payable" : "receivable",
        entityId: parsed.data.payment?.id ?? parsed.data.transfer?.id ?? null,
        actorLabel: "Asaas (webhook)",
        payload: { event: parsed.data.event },
        ipAddress: req.ip,
      });

      return { data: { received: true } };
    },
  );
}
