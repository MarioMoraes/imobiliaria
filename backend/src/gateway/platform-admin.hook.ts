import type { FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { AppError } from "../shared/errors.js";
import { verifyClerkSession } from "../shared/clerk.js";

/**
 * Guard das rotas de PLATAFORMA (`/admin/*` — Super Admin). Hook `onRequest`.
 *
 * Por que não usar o RBAC de tenant aqui: os papéis de tenant (inclusive
 * `SUPER_ADMIN`) são resolvidos a partir de um claim do JWT da organização, e
 * quem administra uma imobiliária consegue mexer nos papéis dentro dela. Gatear
 * a administração da plataforma por esse mesmo mecanismo seria circular — um
 * ADMIN de tenant escalaria para admin da plataforma. Então a identidade de
 * plataforma é independente: sessão válida do Clerk + allowlist de `user_...`
 * em `PLATFORM_ADMIN_CLERK_IDS`.
 *
 * `verifyClerkSession` (não `verifyClerkToken`) porque aqui não existe tenant a
 * resolver: exigimos só a identidade (`sub`).
 *
 * Sem allowlist configurada a área fica trancada — negar é o comportamento
 * correto para uma lista de administradores vazia.
 */
export async function platformAdminHook(req: FastifyRequest): Promise<void> {
  const auth = req.headers["authorization"];
  const bearer =
    typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
  if (!bearer) {
    throw new AppError("UNAUTHORIZED", 401, "Autenticação obrigatória");
  }

  const { userId } = await verifyClerkSession(bearer);
  if (!env.PLATFORM_ADMIN_CLERK_IDS.includes(userId)) {
    throw new AppError("FORBIDDEN", 403, "Acesso restrito à administração da plataforma");
  }
}
