import { z } from "zod";

/**
 * Configuração 12-factor: toda config vem de variáveis de ambiente,
 * validadas na inicialização. Falha cedo (fail-fast) se algo estiver errado.
 *
 * Carrega `backend/.env` (se existir) antes de ler `process.env`, para que
 * segredos locais (ex.: CLERK_SECRET_KEY) fiquem fora do controle de versão.
 * Variáveis já definidas no ambiente têm precedência sobre o arquivo.
 */
try {
  process.loadEnvFile();
} catch {
  // Sem `.env` — segue com as variáveis do ambiente e os defaults abaixo.
}
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z
    .string()
    .default("postgres://app_user:app_user@localhost:5432/imobiliaria"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  RABBITMQ_URL: z.string().default("amqp://guest:guest@localhost:5672"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  // ── Autenticação (MOD-AUTH-05) ─────────────────────────────────
  // Clerk é o provedor de identidade. As chaves são opcionais em dev para não
  // travar o boot; sem elas, o AUTH_DEV_MODE abaixo permite simular a sessão.
  CLERK_SECRET_KEY: z.string().optional(),
  // Chave pública do JWT (PEM) para verificação networkless do token do Clerk.
  CLERK_JWT_KEY: z.string().optional(),
  // Modo de desenvolvimento: sem Authorization, aceita x-tenant-id + x-dev-roles
  // para simular um usuário autenticado. NUNCA pode ficar ligado em produção.
  AUTH_DEV_MODE: z.coerce.boolean().default(true),
});

const parsed = schema.parse(process.env);

// Fail-fast: dev-mode em produção vazaria o gate de autenticação inteiro.
if (parsed.NODE_ENV === "production" && parsed.AUTH_DEV_MODE) {
  throw new Error(
    "AUTH_DEV_MODE não pode estar ligado em produção (bypass de autenticação). Defina AUTH_DEV_MODE=false.",
  );
}

export const env = parsed;
export type Env = typeof env;
