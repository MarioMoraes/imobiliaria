import type { FastifyReply, FastifyRequest } from "fastify";
import { getContext } from "../shared/tenant-context.js";
import { describeAction } from "../modules/audit/audit.actions.js";
import { record } from "../modules/audit/audit.service.js";
import type { AuditStatus } from "../modules/audit/audit.schema.js";

/**
 * Captura automática da trilha de auditoria (MOD-AUTH-07) para TODO o escopo
 * /v1. Registra toda mutação bem-sucedida e toda tentativa barrada por papel.
 *
 * Por que aqui e não em cada service: são ~25 módulos, e cada PRD lista as suas
 * ações. Escrever a chamada à mão em todos custaria caro e, pior, todo módulo
 * novo nasceria fora da trilha. No gateway, o padrão é o inverso — entra na
 * trilha por padrão, e sai só quem estiver marcado como não-auditável em
 * `audit.actions.ts`. O que não cabe num verbo HTTP (download, webhook) usa o
 * `record()` explícito.
 *
 * São dois hooks porque nenhum ponto sozinho tem tudo:
 *  - `onSend` tem o corpo da resposta (de onde sai o id do recém-criado) e roda
 *    dentro do AsyncLocalStorage;
 *  - `onResponse` roda com o cliente já servido, que é onde a escrita no banco
 *    não custa latência ao usuário.
 */

interface Snapshot {
  tenantId: string;
  userId?: string;
  ip?: string;
  requestId?: string;
  entityId: string | null;
  payload: unknown;
}

/**
 * WeakMap em vez de uma propriedade na request: não depende de augmentation de
 * tipo do Fastify e some junto com o objeto quando o request acaba.
 */
const snapshots = new WeakMap<FastifyRequest, Snapshot>();

const AUDITED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Extrai o id do alvo: o `:id` da rota ou, na criação, o `data.id` devolvido. */
function resolveEntityId(req: FastifyRequest, payload: unknown): string | null {
  const params = req.params as Record<string, unknown> | undefined;
  const fromRoute = params?.["id"];
  if (typeof fromRoute === "string") return fromRoute;

  if (typeof payload === "string" && payload.length <= 64 * 1024) {
    try {
      const body = JSON.parse(payload) as { data?: { id?: unknown } };
      const id = body?.data?.id;
      if (typeof id === "string") return id;
    } catch {
      /* resposta não-JSON (PDF, redirect) — segue sem id */
    }
  }
  return null;
}

/** Guarda o que só existe durante o ciclo do request. */
export function auditCaptureHook(
  req: FastifyRequest,
  _reply: FastifyReply,
  payload: unknown,
  done: (err: Error | null, value?: unknown) => void,
): void {
  if (AUDITED_METHODS.has(req.method.toUpperCase())) {
    const ctx = getContext();
    if (ctx) {
      snapshots.set(req, {
        tenantId: ctx.tenantId,
        ...(ctx.userId ? { userId: ctx.userId } : {}),
        ...(ctx.ip ? { ip: ctx.ip } : {}),
        requestId: ctx.requestId,
        entityId: resolveEntityId(req, payload),
        payload: req.body ?? null,
      });
    }
  }
  done(null, payload);
}

/**
 * Grava a linha depois que a resposta já foi enviada (sem `await`: a trilha não
 * atrasa nem derruba o request — `record` já é best-effort).
 *
 * O que entra: mutação com resposta 2xx (`OK`) e tentativa recusada por papel
 * (403 → `DENIED`, exigência dos PRDs 09 e 14). Fica de fora o 401 (não há
 * identidade a atribuir), o 404/422 (não mudou nada) e o 5xx (já vai para o log
 * de erro, e a escrita de domínio não aconteceu).
 */
export function auditRecordHook(
  req: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  done();

  const snapshot = snapshots.get(req);
  if (!snapshot) return;
  snapshots.delete(req);

  const status = reply.statusCode;
  let auditStatus: AuditStatus;
  if (status >= 200 && status < 300) auditStatus = "OK";
  else if (status === 403) auditStatus = "DENIED";
  else return;

  const routeUrl = req.routeOptions?.url;
  if (!routeUrl) return;
  const described = describeAction(req.method, routeUrl);
  if (!described) return;

  void record({
    action: described.action,
    entity: described.entity,
    entityId: snapshot.entityId,
    payload: snapshot.payload,
    status: auditStatus,
    tenantId: snapshot.tenantId,
    userId: snapshot.userId ?? null,
    ipAddress: snapshot.ip ?? null,
    requestId: snapshot.requestId ?? null,
  });
}
