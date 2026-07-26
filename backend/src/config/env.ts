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

  // Ligue APENAS quando o backend estiver atrás de um proxy reverso de
  // confiança (o Caddy do docker-compose.prod.yml). Ligado, o Fastify passa a
  // ler o IP do cliente de `X-Forwarded-For`; desligado, todo request atrás do
  // proxy chega com o IP do PRÓPRIO proxy — e aí o rate limit dos webhooks vira
  // um balde único para o mundo inteiro. O inverso também é perigoso: se o
  // backend for alcançável direto, confiar no cabeçalho deixa qualquer um
  // forjar o próprio IP e escapar do limite. Por isso o default é false.
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((v) => v.trim().toLowerCase() === "true" || v.trim() === "1"),

  // ── Autenticação (MOD-AUTH-05) ─────────────────────────────────
  // Clerk é o provedor de identidade. As chaves são opcionais em dev para não
  // travar o boot; sem elas, o AUTH_DEV_MODE abaixo permite simular a sessão.
  CLERK_SECRET_KEY: z.string().optional(),
  // Chave pública do JWT (PEM) para verificação networkless do token do Clerk.
  CLERK_JWT_KEY: z.string().optional(),
  // Modo de desenvolvimento: sem Authorization, aceita x-tenant-id + x-dev-roles
  // para simular um usuário autenticado. É um bypass completo do gate de
  // autenticação, então o default é DESLIGADO: quem quiser precisa pedir
  // explicitamente, e só vale com NODE_ENV=development (ver `authDevMode()`).
  // Um default ligado transformaria "esqueci de definir NODE_ENV" em "API aberta".
  // NÃO usar z.coerce.boolean(): Boolean("false") === true, então "false" nunca
  // desligaria o dev-mode. Interpretamos a string explicitamente.
  AUTH_DEV_MODE: z
    .string()
    .default("false")
    .transform((v) => v.trim().toLowerCase() === "true" || v.trim() === "1"),

  // Administradores da PLATAFORMA (Super Admin), por id de usuário do Clerk
  // (`user_...`), separados por vírgula. É uma identidade deliberadamente
  // separada do RBAC de tenant: os papéis de tenant vêm de um claim do JWT da
  // organização, e um ADMIN de imobiliária não pode virar admin da plataforma.
  // Default vazio = área de plataforma trancada (nega todo mundo).
  PLATFORM_ADMIN_CLERK_IDS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),

  // ── Object storage (S3-compatível) ─────────────────────────────
  // Mídia (fotos de imóveis) mora no bucket; o Postgres guarda só a chave.
  // Os defaults abaixo são de um MinIO local, mas o docker-compose NÃO sobe
  // MinIO: o bucket é externo (R2) nos dois ambientes. Sem configurar as S3_*,
  // o upload de fotos falha — o resto do sistema funciona.
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

  // ── E-mail transacional (Resend) ───────────────────────────────
  // Diferente da ZapSign/Asaas, a conta é da PLATAFORMA (não por tenant): quem
  // envia é o produto, do seu próprio domínio verificado. Sem a chave o envio
  // fica desligado — o convite ainda é criado no Clerk e o link continua
  // recuperável pela UI ("copiar link do convite").
  RESEND_API_KEY: z.string().optional(),
  // Precisa ser um endereço de domínio VERIFICADO no Resend; senão a API só
  // aceita entregar para o e-mail dono da conta.
  MAIL_FROM: z.string().default("Offices AI <convites@mail.offices-ia.cloud>"),
  RESEND_API_URL: z.string().default("https://api.resend.com"),

  // URL pública do FRONTEND (≠ PUBLIC_BASE_URL, que é este backend). Compõe o
  // redirectUrl do convite: para onde o convidado volta após aceitar no Clerk.
  APP_BASE_URL: z.string().default("http://localhost:3000"),

  // ── Camada de IA (MOD-AI) ──────────────────────────────────────
  // Ao contrário da ZapSign/Asaas, estas contas são da PLATAFORMA e não do
  // tenant: a imobiliária consome créditos de IA (ai_credits), não traz a
  // própria chave. Por isso vivem no env e não em tenant_*_settings.
  //
  // Qual provedor atende. `anthropic` é o alvo de produção; `gemini` existe
  // para desenvolvimento (tem free tier) e implementa as mesmas interfaces —
  // ver modules/ai/providers/index.ts.
  AI_PROVIDER: z.enum(["anthropic", "gemini"]).default("anthropic"),

  // Sem a chave do provedor escolhido, as rotas /v1/ai/* respondem 503 — o
  // resto do produto continua de pé.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  // Modelo barato para a classificação de intenção/sentimento, que é uma
  // tarefa de rótulo e não precisa do orquestrador.
  ANTHROPIC_FAST_MODEL: z.string().default("claude-haiku-4-5"),

  // Embeddings: a Anthropic não expõe API de embeddings; a Voyage é a parceira
  // recomendada. Sem SDK Node oficial — o cliente usa fetch, como o mailer.
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_API_URL: z.string().default("https://api.voyageai.com/v1"),
  // Trocar o modelo muda a dimensão do vetor e invalida o índice inteiro
  // (rag_chunks.embedding é vector(1024)); exige reindexação completa.
  VOYAGE_MODEL: z.string().default("voyage-3"),

  // ── Gemini (AI_PROVIDER=gemini) ────────────────────────────────
  // Chave do Google AI Studio. Os IDs ficam configuráveis porque o catálogo do
  // Gemini gira rápido: a série 2.5 já responde "no longer available to new
  // users" para chaves criadas hoje. Se um ID sair do ar, é uma variável de
  // ambiente, não um deploy.
  //
  // O default é um modelo `lite` de propósito. `gemini-3.6-flash` responde
  // melhor, mas o free tier o limita a 5 requisições por MINUTO — e uma única
  // pergunta consome várias (classificação + cada volta do laço de
  // ferramentas), então duas perguntas seguidas já estouram a cota. Como este
  // provedor existe para testar, previsibilidade vale mais que eloquência.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_FAST_MODEL: z.string().default("gemini-3.5-flash-lite"),
  // Precisa suportar `outputDimensionality` para entregar as 1024 dimensões
  // que `rag_chunks.embedding` espera (ver providers/gemini.client.ts).
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
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

/**
 * Único ponto que decide se o bypass de desenvolvimento está ativo. Exige as
 * DUAS condições: o opt-in explícito e `NODE_ENV=development`.
 *
 * A checagem é positiva de propósito (`=== "development"`, não
 * `!== "production"`): qualquer ambiente que não se declare "development" —
 * staging, um container sem NODE_ENV, um teste de carga — falha fechado.
 */
export function authDevMode(): boolean {
  return env.AUTH_DEV_MODE && env.NODE_ENV === "development";
}
