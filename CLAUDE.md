# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é este projeto

**Offices AI Imobiliária** — SaaS multi-tenant para imobiliárias, com uma camada de
agentes de IA (AaaS) sobre um núcleo de gestão. Os documentos mestres governam o
design e devem ser consultados antes de decisões estruturais:

- `PRD-Imobiliaria-AI.md` — produto (módulos = seções 7 e 8).
- `SPEC-Imobiliaria-AI.md` — arquitetura, stack e padrões. As referências abaixo
  ("SPEC seção X") apontam para ele.

O SPEC descreve um alvo de ~20 microserviços. **Este repositório implementa esse
alvo como um monólito modular** (decisão de início de projeto): um único backend
deployable, com fronteiras de módulo explícitas, para que cada módulo possa ser
promovido a microserviço depois sem reescrever a lógica. Ao ler o SPEC, traduza
"serviço X" para "módulo `backend/src/modules/X`".

## Comandos

Monorepo com **npm workspaces** (`frontend`, `backend`). Rodar da raiz:

```bash
npm install                      # instala todos os workspaces
npm run infra:up                 # Postgres + Redis + RabbitMQ (docker compose)
npm run dev                      # infra + backend + frontend juntos
npm run dev:backend              # só o backend  (porta 3001)
npm run dev:frontend             # só o frontend (porta 3000)
npm run typecheck                # tsc --noEmit em todos os workspaces
npm run build                    # build de ambos
npm run lint
npm test                         # inclui teste de isolamento multi-tenant
npm run infra:down               # para os containers
npm run infra:reset              # para e APAGA o volume (re-roda init.sql)
```

Escopo de um workspace só: `npm run <script> --workspace=backend`.

Rodar **um único teste** do backend (Node test runner, sem framework externo):

```bash
node --import tsx --test backend/src/modules/property/property.test.ts
```

Os testes de integração precisam da infra de pé (`npm run infra:up`).

> Ambiente: se `npm install` falhar com erro de permissão em `~/.npm/_cacache`,
> use `npm install --cache <dir-temporário>`.

### Gate de qualidade rápido

`npm run typecheck` é o gate mais rápido e confiável. TypeScript é `strict` com
`noUncheckedIndexedAccess` no backend — o acesso a arrays/índices retorna
`T | undefined`; por isso o código usa `rows[0]!` após checar `rows[0]`, etc.

## Arquitetura

### Backend — monólito modular (`backend/src/`)

```
config/env.ts            Config 12-factor validada por zod (fail-fast no boot).
shared/                  Libs transversais:
  db.ts                  Pool pg + withTenant() — coração do isolamento (ver abaixo).
  tenant-context.ts      AsyncLocalStorage do tenant + hook Fastify (onRequest).
  events.ts              RabbitMQ (exchange topic "imobiliaria.events"), tolerante a falha.
  redis.ts               Cache (lazyConnect, tolerante a falha).
  errors.ts              AppError + formato único de erro de API.
  logger.ts              Pino (loggerOptions compartilhado com o Fastify).
gateway/routes.ts        Composição de rotas: /health público, /v1/* com tenant.
modules/<dominio>/       property.{schema,repository,service,routes}.ts
app.ts                   buildApp() — monta Fastify (sem listen; facilita testes).
index.ts                 Bootstrap + shutdown gracioso.
```

**Fluxo de um request de domínio:** `routes` (valida com zod) → `service` (regra de
negócio + publica evento) → `repository` (SQL via `withTenant`). Uma rota nunca
chama repository direto; um módulo nunca importa o repository de outro (integração
é por evento ou pelo `service` público do outro módulo). Ver `modules/README.md`
para o padrão e o roadmap dos demais módulos.

### Isolamento multi-tenant (o invariante central — SPEC seção 3)

É a regra que mais importa neste código. Errar aqui vaza dados entre imobiliárias.

- Toda tabela de domínio tem `tenant_id` + **Row-Level Security** no Postgres
  (`infra/postgres/init.sql`). A policy compara `tenant_id` com
  `current_setting('app.tenant_id')`.
- **RLS é ignorado por superusuários.** O backend conecta como `app_user`
  (não-superusuário) — nunca mude o `DATABASE_URL` para um superusuário.
- Todo acesso a dado de domínio passa por `withTenant(tenantId, fn)` (`shared/db.ts`),
  que abre uma transação e define `app.tenant_id` local a ela. **Não** faça
  `pool.query` direto em código de domínio.
- O `tenantId` vem do `getTenantId()` (AsyncLocalStorage), populado pelo
  `tenantContextHook` registrado no escopo `/v1`.
- **Fase 0 (atual):** o tenant é resolvido pelo header `x-tenant-id`. Para migrar
  para o Clerk (JWT com claim `tenant_id`) ou subdomínio, altere apenas
  `resolveTenantId` em `shared/tenant-context.ts` — nada mais depende da origem.
- Ao criar um módulo novo, **adicione um teste de isolamento** no padrão de
  `property.test.ts` (obrigatório no CI conforme SPEC seções 3.1 e 14).

### Frontend (`frontend/src/`)

Next.js App Router (React 19). Server Components buscam o backend via
`lib/api.ts`, que injeta o `x-tenant-id` (Fase 0). Ao introduzir o Clerk, esse
helper passa a repassar o token da sessão. Páginas em `app/`; estilos globais em
`app/globals.css`.

### Infra local

`docker-compose.yml` sobe Postgres (16), Redis (7) e RabbitMQ (3, painel em
:15672 guest/guest). `infra/postgres/init.sql` roda **só na primeira criação do
volume** — para reaplicar o schema/seed use `npm run infra:reset`. O seed cria o
tenant demo `00000000-0000-0000-0000-000000000001` com imóveis de exemplo.

## Convenções

- ESM em todo o backend (`"type": "module"` + `module: NodeNext`): imports
  relativos **precisam** da extensão `.js` (ex.: `import { env } from "../config/env.js"`),
  mesmo apontando para arquivos `.ts`.
- Eventos nomeados `entidade.acao` (ex.: `property.created`); todo consumidor deve
  ser idempotente por `eventId` (SPEC 4.1 e 12).
- Erros de API sempre no formato `{ "error": { "code", "message", "details? } }`
  (use/estenda `AppError`). Respostas de sucesso envelopam em `{ "data": ... }`.
- **Tela sem dado não diz "backend offline".** Os `fetch*` de `lib/api.ts` devolvem
  `null` para qualquer falha, mas classificam a causa (offline / sem tenant /
  sem permissão / erro). A tela pega o texto em `backendNotice()` — chamado
  DEPOIS das leituras, na mesma request — e o exibe com `<BackendNotice>`; em
  Client Component, passe-o como prop. Nunca crave a causa na mensagem: era o
  que mandava o usuário subir um backend que já estava no ar.
- Novos módulos: crie a pasta seguindo `property/`, registre as rotas em
  `gateway/routes.ts` e adicione as tabelas (com `tenant_id` + RLS ativado). O
  schema hoje vive em `infra/postgres/init.sql`; escolher uma ferramenta de
  migração (ex.: node-pg-migrate/Drizzle) é um TODO de Fundação (SPEC seção 17).
- **Auditoria é automática** (MOD-AUTH-07): toda mutação de `/v1` vira linha em
  `audit_logs` pelo hook do gateway (`gateway/audit.hook.ts`) — módulo novo já
  nasce auditado, sem escrever nada. Ajuste o nome da ação em
  `modules/audit/audit.actions.ts` quando o derivado da rota não descrever o
  fato; use `record()` só para o que não é mutação HTTP (download, webhook). A
  tabela não aceita UPDATE: a trilha é imutável por privilégio do banco.
