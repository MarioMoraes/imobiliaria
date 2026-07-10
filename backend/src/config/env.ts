import { z } from "zod";

/**
 * Configuração 12-factor: toda config vem de variáveis de ambiente,
 * validadas na inicialização. Falha cedo (fail-fast) se algo estiver errado.
 */
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
});

export const env = schema.parse(process.env);
export type Env = typeof env;
