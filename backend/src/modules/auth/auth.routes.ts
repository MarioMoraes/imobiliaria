import type { FastifyInstance } from "fastify";
import { AppError } from "../../shared/errors.js";
import { onboardingSchema } from "./auth.schema.js";
import * as service from "./auth.service.js";

/**
 * Rotas de autenticação. `POST /onboarding` é PÚBLICO (ainda não há tenant): é
 * registrado FORA do escopo /v1 tenant-scoped no gateway, então não passa pelos
 * hooks de resolução de tenant. Cria o tenant e o primeiro ADMIN.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/onboarding", async (req, reply) => {
    const parsed = onboardingSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Dados de onboarding inválidos", parsed.error.flatten());
    }
    // Sessão Clerk (usuário já autenticado, ainda sem org) → cria a org no onboarding.
    const auth = req.headers["authorization"];
    const bearer =
      typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;

    const result = await service.onboarding(parsed.data, bearer);
    reply.code(201);
    return { data: result };
  });
}
