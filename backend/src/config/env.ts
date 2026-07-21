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
  // NÃO usar z.coerce.boolean(): Boolean("false") === true, então "false" nunca
  // desligaria o dev-mode. Interpretamos a string explicitamente.
  AUTH_DEV_MODE: z
    .string()
    .default("true")
    .transform((v) => v.trim().toLowerCase() === "true" || v.trim() === "1"),

  // ── Object storage (S3-compatível; MinIO em dev) ───────────────
  // Mídia (fotos de imóveis) mora no bucket; o Postgres guarda só a chave.
  // Defaults apontam para o MinIO local do docker-compose.
  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().default("minioadmin"),
  S3_SECRET_KEY: z.string().default("minioadmin"),
  S3_BUCKET: z.string().default("imobiliaria-media"),
  // MinIO exige path-style (host/bucket/key). S3/R2 aceitam ambos.
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v.trim().toLowerCase() === "true" || v.trim() === "1"),

  // ── Gotenberg (HTML → PDF, MOD-CONTRATO) ───────────────────────
  // Serviço stateless de conversão. Default aponta para o container local
  // (docker-compose expõe 3050→3000 p/ não colidir com o frontend :3000).
  GOTENBERG_URL: z.string().default("http://localhost:3050"),

  // ── Segredos em repouso (shared/crypto.ts) ─────────────────────
  // Chave AES-256 em base64 (32 bytes): `openssl rand -base64 32`. O default é
  // um valor FIXO de desenvolvimento — em produção o boot exige uma chave real
  // (ver o fail-fast abaixo), senão os tokens de terceiros estariam "cifrados"
  // com uma chave pública neste repositório.
  // `.env` copiado do exemplo costuma trazer a chave VAZIA — isso passaria pelo
  // z.string() e só quebraria na 1ª cifragem, com um erro obscuro. Tratamos
  // vazio como ausente.
  APP_ENCRYPTION_KEY: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : "ZGV2LW9ubHkta2V5LWRvLW5vdC11c2UtaW4tcHJvZCE=")), // "dev-only-key-do-not-use-in-prod!"

  // ── Assinatura eletrônica (MOD-ASSINATURA / ZapSign) ───────────
  // O token da API NÃO fica aqui: é por tenant, cifrado no banco
  // (tenant_signature_settings). Aqui ficam só os endereços do provedor.
  ZAPSIGN_API_URL: z.string().default("https://api.zapsign.com.br/api/v1"),
  ZAPSIGN_SANDBOX_API_URL: z.string().default("https://sandbox.api.zapsign.com.br/api/v1"),
  // ── Cobrança bancária (MOD-FIN / Asaas) ────────────────────────
  // Mesma regra: a chave da API é por tenant, cifrada em
  // tenant_payment_settings. Aqui só os endereços.
  ASAAS_API_URL: z.string().default("https://api.asaas.com/v3"),
  ASAAS_SANDBOX_API_URL: z.string().default("https://api-sandbox.asaas.com/v3"),

  // URL pública deste backend — compõe o endereço dos webhooks registrados na
  // ZapSign e no Asaas. Em localhost o registro automático é pulado (o provedor
  // não alcançaria a máquina); use o botão "Sincronizar".
  PUBLIC_BASE_URL: z.string().default("http://localhost:3001"),
});

const parsed = schema.parse(process.env);

// Fail-fast: dev-mode em produção vazaria o gate de autenticação inteiro.
if (parsed.NODE_ENV === "production" && parsed.AUTH_DEV_MODE) {
  throw new Error(
    "AUTH_DEV_MODE não pode estar ligado em produção (bypass de autenticação). Defina AUTH_DEV_MODE=false.",
  );
}

// Fail-fast: a chave de desenvolvimento está versionada — usá-la em produção
// equivale a guardar os tokens dos tenants em texto claro.
if (parsed.NODE_ENV === "production" && !process.env.APP_ENCRYPTION_KEY?.trim()) {
  throw new Error(
    "APP_ENCRYPTION_KEY é obrigatória em produção (gere com: openssl rand -base64 32).",
  );
}

export const env = parsed;
export type Env = typeof env;
