# Offices AI Imobiliária

Plataforma SaaS **multi-tenant** para imobiliárias e administradoras de imóveis,
com uma camada de **agentes de IA (AaaS)** sobre o núcleo de gestão.

Documentos mestres: [`PRD-Imobiliaria-AI.md`](./PRD-Imobiliaria-AI.md) (produto) e
[`SPEC-Imobiliaria-AI.md`](./SPEC-Imobiliaria-AI.md) (arquitetura).

## Estrutura

Monorepo com **npm workspaces**, frontend e backend em diretórios separados:

```
.
├── frontend/            # Next.js (App Router) — painel + portais
├── backend/             # Monólito modular (Fastify) — módulos por domínio
│   └── src/
│       ├── modules/     # property (referência), health, ... (ver src/modules/README.md)
│       ├── shared/      # db (RLS), tenant-context, events, redis, logger, errors
│       ├── gateway/     # composição de rotas /v1
│       └── config/
├── infra/postgres/      # init.sql (schema + RLS + seed)
└── docker-compose.yml   # PostgreSQL, Redis, RabbitMQ (dev local)
```

> O backend nasce como **monólito modular**: um único deployable com fronteiras de
> módulo explícitas. Cada módulo mapeia um serviço do SPEC e pode ser promovido a
> microserviço depois sem reescrever a lógica de domínio.

## Começando

Pré-requisitos: Node.js ≥ 20, Docker.

```bash
# 1. Instalar dependências (todos os workspaces)
npm install

# 2. Subir infra local (Postgres/Redis/RabbitMQ). O init.sql cria o schema,
#    ativa RLS e insere um tenant demo com imóveis de exemplo.
npm run infra:up

# 3. Configurar env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# 4. Rodar backend + frontend juntos
npm run dev
```

- Backend: http://localhost:3001 — teste `GET /health` e `GET /v1/properties`
  (com header `x-tenant-id: 00000000-0000-0000-0000-000000000001`).
- Frontend: http://localhost:3000 — página inicial e `/properties`.

## Scripts (raiz)

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe infra + backend + frontend (concurrently) |
| `npm run dev:backend` / `npm run dev:frontend` | Sobe um lado só |
| `npm run build` | Build de backend e frontend |
| `npm run typecheck` | `tsc --noEmit` em todos os workspaces |
| `npm run lint` | Lint em todos os workspaces |
| `npm test` | Testes (inclui teste de isolamento multi-tenant) |
| `npm run infra:up` / `infra:down` / `infra:reset` | Gerencia containers |

## Multi-tenancy (resumo)

Isolamento por linha: toda tabela de domínio tem `tenant_id` + **Row-Level
Security** no Postgres. O backend conecta como `app_user` (não-superusuário) e
define o tenant corrente por transação via `withTenant(tenantId, ...)`
(`backend/src/shared/db.ts`). Ver SPEC seção 3.
