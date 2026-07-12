# PRD Detalhado — Autenticação, Identidade & Multi-tenancy

**Módulo:** MOD-AUTH
**Arquivo:** 01/20
**Prioridade:** P0
**Fase de Implementação:** 0 (Fundação)
**Serviço Backend:** auth-service + tenant-service (no monólito modular: `backend/src/modules/{auth,tenant}`, porta 3001)
**Tabelas Principais:** tenants, users, roles, user_roles, tenant_config, feature_flags, audit_logs, sessions
**Data:** 2026-07-10
**Status:** Em implementação — MOD-AUTH-01, 02, 03 e 04 concluídos (2026-07-11); MOD-AUTH-05 (Clerk) implementado, pendente de validação com chaves Clerk; demais pendentes

> **Nota de arquitetura:** o SPEC descreve `auth-service`/`tenant-service` como microserviços. Este repositório os implementa como módulos de um **monólito modular** (`backend/src/modules/`), promovíveis a serviço depois. Onde este PRD diz "serviço X", leia "módulo X". A resolução de tenant hoje (Fase 0) usa o header `x-tenant-id`; a migração para Clerk altera apenas `resolveTenantId` em `shared/tenant-context.ts`.

---

## 1. Visão Geral

**Contexto de negócio.** Toda a plataforma Move AI Imobiliária é multi-tenant: cada imobiliária é um `tenant` isolado. Este módulo é a fundação de segurança de todo o produto — sem uma identidade confiável e sem isolamento de tenant garantido, qualquer outro módulo pode vazar dados entre imobiliárias concorrentes, o que é uma falha crítica de negócio (quebra de confiança irreversível) e legal (LGPD). O módulo entrega: onboarding self-service de novas imobiliárias, autenticação (via Clerk na Fase 0+), autorização RBAC granular e a resolução/injeção do `tenant_id` em toda requisição.

**Integração sistêmica.** É **upstream de todos os outros módulos**: cada rota `/v1/*` de domínio depende do `tenantContextHook` (que resolve o tenant) e do middleware de RBAC deste módulo. A matriz de permissões definida aqui (seção 9) é a **referência canônica** herdada por todos os PRDs seguintes. Publica os eventos `tenant.created`, `user.invited`, `user.activated` consumidos por `notification-service`, `billing-service` (MOD-BILLING) e `admin-service` (MOD-SADMIN).

**Escopo desta fase.** MVP inclui: modelo de tenant + RLS PostgreSQL, resolução de tenant por header (Fase 0) com contrato pronto para JWT/Clerk, os 8 papéis-padrão + matriz RBAC, onboarding wizard de 5 etapas, ciclo de vida de JWT (access 15min + refresh 30 dias com rotação), audit log de ações sensíveis. **Fora desta fase:** papéis 100% customizáveis por tenant (apenas papéis-padrão no MVP), SSO/SAML corporativo, MFA por hardware key (Clerk cobre TOTP/SMS).

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-AUTH-01 | Modelo de Tenant + RLS | Tabela `tenants` + Row-Level Security em toda tabela de domínio | Must Have ✅ |
| MOD-AUTH-02 | Resolução de tenant | Middleware que resolve `tenant_id` (header Fase 0 → JWT Clerk) e injeta no AsyncLocalStorage | Must Have ✅ |
| MOD-AUTH-03 | RBAC (8 papéis + matriz) | Papéis-padrão e verificação de permissão por operação | Must Have ✅ |
| MOD-AUTH-04 | Onboarding wizard (5 etapas) | Fluxo self-service de criação de tenant e primeiro admin | Must Have ✅ (Fase 0: submissão em 1 passo; retomada de rascunho/AC-03 = TODO) |
| MOD-AUTH-05 | Ciclo de vida de JWT | Access 15min + refresh 30d com rotação a cada refresh | Must Have ✅ (via Clerk; refresh/rotação geridos pelo Clerk — pendente validação com chaves) |
| MOD-AUTH-06 | Convite de membros | Admin convida usuários por e-mail com papel pré-definido | Must Have |
| MOD-AUTH-07 | Audit log | Registro imutável de login, mudança de papel, criação/suspensão de usuário | Must Have |
| MOD-AUTH-08 | MFA | TOTP/SMS via Clerk para usuários internos | Should Have |
| MOD-AUTH-09 | Papéis customizados por tenant | Definição de papéis próprios além dos padrão | Nice to Have |

## 3. Critérios de Aceite

### [MOD-AUTH-01] — Modelo de Tenant + RLS

**AC-01 (Happy Path)**
- **Dado** que existe o tenant `T1` e uma sessão com `app.tenant_id = T1`
- **Quando** o `property-service` executa `SELECT * FROM properties`
- **Então** somente linhas com `tenant_id = T1` retornam, por força da policy RLS, **mesmo que a query não filtre `tenant_id` explicitamente** (HTTP 200).

**AC-02 (Isolamento / Erro)**
- **Dado** que a sessão está com `app.tenant_id = T1`
- **Quando** a aplicação tenta `SELECT * FROM properties WHERE tenant_id = 'T2'`
- **Então** o resultado é **vazio** (RLS filtra antes do `WHERE`), e nenhuma linha de `T2` é exposta.

**AC-03 (Edge Case — superusuário)**
- **Dado** que o backend está configurado com um usuário de banco superusuário (config incorreta)
- **Quando** qualquer query roda
- **Então** o teste automatizado de "tenant leakage" no CI **falha o build** (RLS é ignorado por superusuário; conexão DEVE ser `app_user` não-superusuário).

### [MOD-AUTH-02] — Resolução de tenant

**AC-01 (Happy Path)**
- **Dado** um request para `/v1/properties` com header `x-tenant-id: T1` (Fase 0)
- **Quando** o `tenantContextHook` roda no `onRequest`
- **Então** `getTenantId()` retorna `T1` dentro do handler e `withTenant(T1, fn)` abre transação com `SET LOCAL app.tenant_id = 'T1'` (HTTP 200).

**AC-02 (Erro)**
- **Dado** um request para `/v1/*` **sem** `x-tenant-id` (e sem JWT válido)
- **Quando** o hook roda
- **Então** retorna `401` com `ERR_AUTH_005` "Tenant não resolvido".

**AC-03 (Edge Case — tenant suspenso)**
- **Dado** um tenant `T1` com `status = SUSPENDED`
- **Quando** qualquer request `/v1/*` chega
- **Então** retorna `403` `ERR_AUTH_006` "Tenant suspenso", exceto rotas de billing/pagamento de regularização.

### [MOD-AUTH-03] — RBAC

**AC-01 (Happy Path)** — **Dado** um usuário com papel `GESTOR`, **Quando** faz `POST /v1/properties`, **Então** a operação é permitida (HTTP 201).
**AC-02 (Permissão negada)** — **Dado** um usuário `CORRETOR`, **Quando** faz `DELETE /v1/properties/:id`, **Então** retorna `403` `ERR_AUTH_003` "Papel insuficiente para esta operação".
**AC-03 (Edge Case)** — **Dado** um usuário sem papel atribuído (convite pendente), **Quando** acessa qualquer rota autenticada, **Então** retorna `403` `ERR_AUTH_007` "Usuário sem papel ativo".

### [MOD-AUTH-04] — Onboarding wizard

**AC-01 (Happy Path)** — **Dado** um visitante na landing de cadastro, **Quando** completa as 5 etapas (dados da imobiliária → plano → config inicial → convite de membros → primeiro acesso), **Então** um `tenant` é criado (`status=TRIAL`), o primeiro usuário vira `ADMIN`, evento `tenant.created` é publicado e o usuário é redirecionado ao painel (HTTP 201).
**AC-02 (Erro)** — **Dado** um CNPJ já cadastrado em outro tenant, **Quando** submete a etapa 1, **Então** retorna `409` `ERR_AUTH_004` "CNPJ já cadastrado".
**AC-03 (Edge Case — abandono)** — **Dado** que o usuário abandona no passo 3, **Quando** retorna com o mesmo e-mail em 7 dias, **Então** o wizard **retoma do passo salvo** (rascunho de onboarding persistido), sem duplicar tenant.

### [MOD-AUTH-05] — Ciclo de vida de JWT

**AC-01 (Happy Path)** — **Dado** um refresh token válido, **Quando** o access token de 15min expira e o cliente chama `/v1/auth/refresh`, **Então** recebe **novo par** access+refresh e o refresh anterior é invalidado (rotação), HTTP 200.
**AC-02 (Erro — reuso)** — **Dado** um refresh token **já rotacionado** (reuso/roubo), **Quando** é apresentado novamente, **Então** retorna `401` `ERR_AUTH_008`, **toda a família de tokens é revogada** e evento `security.token_reuse_detected` é auditado.
**AC-03 (Edge Case)** — **Dado** um refresh token de 30 dias expirado, **Quando** usado, **Então** `401` e exige novo login completo.

## 4. Modelo de Dados

### Tabelas Envolvidas

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| tenants | id | String (CUID/UUID) | ✓ | PK do tenant |
| tenants | name | String | ✓ | Nome fantasia da imobiliária |
| tenants | cnpj | String (criptografado) | ✓ | CNPJ único global |
| tenants | slug | String | ✓ | Subdomínio (`slug.moveai.com.br`), único global |
| tenants | status | Enum | ✓ | TRIAL, ACTIVE, SUSPENDED, CANCELED |
| tenants | plan_id | String | ✓ | Plano contratado (FK billing) |
| tenants | creci | String | — | Registro CRECI da imobiliária |
| users | id | String | ✓ | PK |
| users | tenant_id | String | ✓ | Isolamento multi-tenant |
| users | clerk_external_id | String | — | Vínculo com Clerk (nulo na Fase 0) |
| users | email | String (criptografado) | ✓ | Único por tenant |
| users | full_name | String | ✓ | Nome |
| users | status | Enum | ✓ | INVITED, ACTIVE, DISABLED |
| user_roles | user_id | String | ✓ | FK users |
| user_roles | role | Enum | ✓ | SUPER_ADMIN, ADMIN, GESTOR, CORRETOR, FINANCEIRO, PROPRIETARIO, CLIENTE, AI_AGENT |
| tenant_config | tenant_id | String | ✓ | 1:1 com tenant |
| tenant_config | branding_json | JSONB | — | Logo, cores, favicon |
| tenant_config | integrations_json | JSONB (criptografado) | — | Chaves Asaas/Stripe/WhatsApp do tenant |
| sessions | refresh_token_hash | String | ✓ | Hash do refresh (nunca em claro) |
| sessions | family_id | String | ✓ | Família p/ detecção de reuso |
| audit_logs | id, tenant_id, user_id, action, entity, entity_id, payload, ip_address, created_at | — | ✓ | Registro imutável |

### Campos com Criptografia AES-256-GCM (em repouso)

| Campo | Tabela | Justificativa LGPD/PCI |
|---|---|---|
| cnpj | tenants | Dado identificável da PJ |
| email | users | Dado pessoal (LGPD) |
| integrations_json | tenant_config | Segredos de terceiros (Asaas/Stripe) — nunca em claro |
| refresh_token_hash | sessions | Credencial de sessão (armazenar apenas hash) |

### Índices Necessários

```sql
CREATE UNIQUE INDEX idx_tenants_slug ON tenants(slug);
CREATE UNIQUE INDEX idx_tenants_cnpj ON tenants(cnpj);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE UNIQUE INDEX idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_sessions_family ON sessions(family_id);
CREATE INDEX idx_audit_tenant_created ON audit_logs(tenant_id, created_at DESC);
```

### RLS — política padrão (aplicada a TODA tabela de domínio)

```sql
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON properties
  USING (tenant_id = current_setting('app.tenant_id')::text);
-- backend conecta como app_user (NÃO superusuário) para a policy valer.
-- withTenant() faz: BEGIN; SET LOCAL app.tenant_id = $1; ... ; COMMIT;
```

## 5. Contratos de API

Todos os endpoints `/v1/*` exigem `Authorization: Bearer <jwt>` (ou `x-tenant-id` na Fase 0) e inferem `tenant_id`. Paginação padrão `?page=1&limit=20`. Respostas: sucesso `{ data }`, erro `{ error: { code, message, details? } }`.

### Endpoints

| Método | Path | Roles | Descrição |
|---|---|---|---|
| POST | /v1/auth/onboarding | público | Inicia/continua wizard de tenant |
| POST | /v1/auth/refresh | autenticado | Rotaciona par de tokens |
| POST | /v1/auth/logout | autenticado | Revoga família de refresh |
| GET | /v1/users | ADMIN, GESTOR | Lista usuários do tenant |
| POST | /v1/users/invite | ADMIN | Convida membro (e-mail + papel) |
| PATCH | /v1/users/:id/role | ADMIN | Altera papel |
| PATCH | /v1/users/:id/status | ADMIN | Ativa/desativa usuário |
| GET | /v1/tenant/config | ADMIN, GESTOR | Config e branding do tenant |
| PATCH | /v1/tenant/config | ADMIN | Atualiza branding/integrações |

### Schema Zod — pacote `@move-ai/shared`

```typescript
import { z } from 'zod'

export const TenantOnboardingSchema = z.object({
  step: z.number().int().min(1).max(5),
  studio: z.object({
    name: z.string().min(2),
    cnpj: z.string().regex(/^\d{14}$/),
    creci: z.string().optional(),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,49}$/),
  }).partial(),
  planId: z.string().optional(),
  invites: z.array(z.object({
    email: z.string().email(),
    role: z.enum(['ADMIN','GESTOR','CORRETOR','FINANCEIRO']),
  })).optional(),
})
export type TenantOnboardingInput = z.infer<typeof TenantOnboardingSchema>

export const InviteUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  role: z.enum(['ADMIN','GESTOR','CORRETOR','FINANCEIRO']),
})

export const UserResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  email: z.string().email(),
  fullName: z.string(),
  roles: z.array(z.string()),
  status: z.enum(['INVITED','ACTIVE','DISABLED']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
```

### Códigos de Erro Padronizados

| Código | HTTP | Cenário |
|---|---|---|
| ERR_AUTH_001 | 404 | Usuário/tenant não encontrado |
| ERR_AUTH_002 | 422 | Dados de entrada inválidos |
| ERR_AUTH_003 | 403 | Papel insuficiente |
| ERR_AUTH_004 | 409 | Conflito (CNPJ/slug/email duplicado) |
| ERR_AUTH_005 | 401 | Tenant não resolvido |
| ERR_AUTH_006 | 403 | Tenant suspenso |
| ERR_AUTH_007 | 403 | Usuário sem papel ativo |
| ERR_AUTH_008 | 401 | Reuso de refresh token detectado |

## 6. Máquinas de Estado

### Tenant — Status

```
(criação via wizard)
        │
        ▼
     TRIAL ──(ação: assinar plano pago)──────────► ACTIVE
        │                                            │
        │(ação: fim do trial sem pagamento)          │(ação: falha de pagamento D+X)
        ▼                                            ▼
   SUSPENDED ◄──────(ação: inadimplência)──────── SUSPENDED
        │                                            │
        │(ação: regularizar pagamento)               │(ação: cancelamento pelo admin/super admin)
        ▼                                            ▼
     ACTIVE                                      CANCELED (soft delete + retenção LGPD)
```

### Usuário — Status

```
INVITED ──(aceita convite + define credencial)──► ACTIVE ──(admin desativa)──► DISABLED
                                                     ▲                              │
                                                     └────────(reativar)───────────┘
```

**Efeitos colaterais por transição:**

| De | Para | Evento RabbitMQ | Notificações | Audit |
|---|---|---|---|---|
| — | TRIAL | `tenant.created` | e-mail boas-vindas (Resend) | ✓ |
| TRIAL | ACTIVE | `tenant.activated` | e-mail confirmação | ✓ |
| ACTIVE | SUSPENDED | `tenant.suspended` | e-mail + in-app admin | ✓ |
| — | INVITED | `user.invited` | e-mail de convite | ✓ |
| INVITED | ACTIVE | `user.activated` | — | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos Afetados |
|---|---|---|---|
| RN-01 | Conexão de banco deve ser não-superusuário | `DATABASE_URL` usa `app_user`; boot falha se detectar `rolsuper` | Todos |
| RN-02 | `slug` único globalmente (não por tenant) | Validação global; reservado para subdomínio (MOD-DNS) | MOD-DNS, MOD-LP |
| RN-03 | Rotação de refresh: reuso revoga família inteira | Detecção de roubo de token | Segurança |
| RN-04 | Último ADMIN não pode se auto-remover | Bloqueia se `count(ADMIN ativos) == 1` | — |
| RN-05 | AI_AGENT é ator não-humano com escopo restrito | Nunca recebe permissão de DELETE nem edição financeira | MOD-AI |
| RN-06 | Migração Fase 0 → Clerk | Trocar só `resolveTenantId`; contrato de `getTenantId()` imutável | Todos |

## 8. Eventos RabbitMQ

Exchange `imobiliaria.events` (topic) | DLX com backoff exponencial (1s, 5s, 30s, 5min).

| Evento (routing key) | Publisher | Consumers | Payload Mínimo |
|---|---|---|---|
| `tenant.created` | auth/tenant | billing, notification, admin | `{ tenantId, plan, timestamp }` |
| `tenant.activated` | tenant | billing, admin | `{ tenantId, plan, timestamp }` |
| `tenant.suspended` | tenant | todos | `{ tenantId, reason, timestamp }` |
| `user.invited` | auth | notification | `{ tenantId, userId, email, role }` |
| `user.activated` | auth | admin | `{ tenantId, userId, timestamp }` |
| `security.token_reuse_detected` | auth | admin, notification | `{ tenantId, userId, ip, timestamp }` |

## 9. Segurança & LGPD

### Controle de Acesso por Operação (MATRIZ CANÔNICA — herdada por todos os módulos)

| Operação | Super Admin | Admin Tenant | Gestor | Financeiro | Corretor | Portal Externo* |
|---|---|---|---|---|---|---|
| Gerir usuários/papéis | ✓ | ✓ | — | — | — | — |
| Config do tenant | ✓ | ✓ | leitura | — | — | — |
| Imóveis (CRUD) | ✓ | ✓ | ✓ | leitura | criar/editar próprios | leitura pública |
| Financeiro | ✓ | ✓ | leitura | ✓ | comissões próprias | próprios repasses |
| Contratos | ✓ | ✓ | ✓ | leitura | próprios | próprios |
| CRM/Leads | ✓ | ✓ | ✓ | — | atribuídos | — |
| Deletar (soft) | ✓ | ✓ | — | — | — | — |

*Portal Externo = Proprietário e Cliente/Inquilino, cada um restrito às suas próprias entidades.

### Audit Log (tabela `audit_logs`)

Ações que DEVEM gerar registro imutável: `login`, `logout`, `role.changed`, `user.disabled`, `tenant.suspended`, `config.integrations.updated`, `token.reuse` → campos: `action, entity, entityId, userId, tenantId, payload, ipAddress, createdAt`.

### Dados Pessoais (LGPD)

| Campo | Categoria | Base Legal | Retenção | Exportável | Deletável |
|---|---|---|---|---|---|
| email, full_name | Dado pessoal | Execução de contrato | Vida do tenant + 5 anos | ✓ | ✓ (anonimização) |
| cnpj | Dado da PJ | Obrigação legal | 5 anos após cancelamento | ✓ | — |
| ip_address (audit) | Dado pessoal | Legítimo interesse (segurança) | 12 meses | ✓ | — |

## 10. Performance & Observabilidade

### Cache Redis

| Dado | TTL | Chave | Invalida quando |
|---|---|---|---|
| Papéis do usuário | 300s | `rbac:{tenantId}:{userId}` | `role.changed` |
| Config/branding do tenant | 600s | `tenant:cfg:{tenantId}` | `config.updated` |
| Status do tenant | 60s | `tenant:status:{tenantId}` | `tenant.suspended/activated` |

### Métricas de Negócio (Pino)

```json
{ "metric": "onboarding_completed", "tenantId": "...", "value": 1, "unit": "count" }
```

- `onboarding_completion_rate`: % de wizards concluídos vs iniciados (diário).
- `auth_token_reuse_events`: contagem de detecções de reuso (tempo real, alerta).
- `active_users_per_tenant`: usuários ativos por tenant (diário).

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Papéis customizados por tenant entram em qual fase? | RBAC, todos | PM/Tech Lead | Fase 2 |
| 2 | MFA obrigatório para ADMIN/FINANCEIRO ou opcional? | Segurança | PM/Compliance | Antes Fase 1 |
| 3 | Período exato do TRIAL (7 vs 14 dias) | Billing, ativação | PM | Antes go-live |

## 12. Setup Clerk (necessário para o login ao vivo)

O login (MOD-AUTH-05) está implementado. Para ativar o caminho Clerk real (fora do dev-mode):

**Arquitetura adotada:** Clerk = **autenticação** (quem é + qual tenant, via claims do JWT);
nosso banco (`user_roles`) = **autorização** (RBAC). Troca de provedor = trocar
`backend/src/shared/clerk.ts` + `resolveAuth` em `shared/tenant-context.ts` (contrato de
`getTenantId()`/`getAuthUser()` imutável — RN-06).

**Automatizado pelo onboarding** (`modules/auth/`, fluxo Clerk): ao submeter o onboarding com a
sessão Clerk, o backend **cria a Organização** (`createdBy` = usuário → vira admin da org), cria o
tenant + admin no banco vinculando `users.clerk_external_id` e `tenants.clerk_org_id`, e grava
`org.public_metadata.tenant_id`. O frontend (`/onboarding`) chama `setActive(org)` e segue ao painel.

**Checklist (você) — só o que depende do dashboard:**
1. Criar app no [Clerk Dashboard](https://dashboard.clerk.com) e **habilitar Organizations**
   (Configure → Organizations). Sem isso a API retorna `organization_not_enabled_in_instance`.
2. Em **API Keys**, copiar `CLERK_SECRET_KEY` (→ `backend/.env`) e
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` (→ `frontend/.env.local`).
   **Nunca** commitar a chave secreta (os `.env.example` têm só placeholders).
3. **Sessions → Customize session token**: adicionar o claim
   `"tenant_id": "{{org.public_metadata.tenant_id}}"`. É esse claim que o backend lê em
   `verifyClerkToken` para as rotas /v1. (Os passos 4–5 do fluxo anterior agora são automáticos.)
4. Definir `AUTH_DEV_MODE=false` em produção (o boot falha se ficar `true`).

**Sem chaves (dev):** `AUTH_DEV_MODE=true` — o backend aceita `x-tenant-id` + `x-dev-roles`
(csv) e o frontend roda em keyless mode; o `lib/api.ts` cai no fallback do tenant demo.
