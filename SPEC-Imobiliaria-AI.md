# SPEC — Imobiliária AI
### Documento Técnico Mestre (Arquitetura, Stack, Padrões e Infraestrutura)

| Campo | Valor |
|---|---|
| Produto | Move AI Imobiliária |
| Documento irmão | PRD-Move-AI-Imobiliaria.md |
| Versão do documento | 1.0 |
| Status | Base para SPECs de módulo/microserviço |

---

## 1. Visão Arquitetural

Move AI Imobiliária é construído como um **monorepo** contendo múltiplos pacotes/serviços, organizado para suportar:

- Multi-tenancy nativo em todas as camadas.
- Backend em **microserviços** independentes, comunicando-se via API síncrona (REST/HTTP interno) e eventos assíncronos (RabbitMQ).
- Frontend web em **Next.js/React**, consumindo os serviços via um **BFF (Backend For Frontend) / API Gateway**.
- Camada de **agentes de IA** orquestrada via **LangGraph**, desacoplada dos serviços de domínio, consumindo-os como ferramentas (tools).
- Infraestrutura containerizada (Docker), orquestrada inicialmente via **Docker Swarm**, com desenho compatível com migração futura para **Kubernetes**.

```
                         ┌─────────────────────────┐
                         │   Cloudflare (CDN/WAF)   │
                         └────────────┬─────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │   API Gateway / BFF        │
                         └────┬───────────┬──────────┘
                              │           │
          ┌───────────────────┘           └───────────────────┐
          │                                                     │
┌─────────▼─────────┐                               ┌──────────▼──────────┐
│  Microserviços de  │                               │  Camada de Agentes   │
│  Domínio (Core)     │◄──────── eventos/API ────────►│  (LangGraph / AaaS)  │
└─────────┬─────────┘                               └──────────┬──────────┘
          │                                                     │
   ┌──────▼──────┐   ┌────────────┐   ┌───────────┐     ┌──────▼──────┐
   │ PostgreSQL   │   │  RabbitMQ  │   │   Redis    │     │  Provedores  │
   │ (multi-tenant)│  │ (eventos)  │   │ (cache/fila)│    │  de IA/LLM   │
   └──────────────┘   └────────────┘   └───────────┘     └─────────────┘
```

---

## 2. Estrutura do Monorepo

```
move-ai-imobiliaria/
├── landingpage/          # Landing pages públicas por tenant (Next.js, SSG/ISR)
├── frontend/             # Aplicação web principal (painel interno + portais)
├── backend/
│   ├── services/
│   │   ├── auth-service/
│   │   ├── tenant-service/
│   │   ├── property-service/         # Imóveis
│   │   ├── owner-service/            # Proprietários
│   │   ├── customer-service/         # Clientes / CRM base
│   │   ├── broker-service/           # Corretores
│   │   ├── employee-service/         # Funcionários / RH básico
│   │   ├── scheduling-service/       # Agenda (visitas, vistorias, reuniões)
│   │   ├── crm-service/              # Funil, leads, automações
│   │   ├── contract-service/         # Contratos
│   │   ├── financial-service/        # Financeiro completo
│   │   ├── rental-service/           # Gestão de aluguel
│   │   ├── maintenance-service/      # Manutenção
│   │   ├── document-service/         # Gestão documental / OCR
│   │   ├── portal-service/           # BFF dos portais (proprietário/cliente/corretor)
│   │   ├── publishing-service/       # Publicação em portais imobiliários
│   │   ├── notification-service/     # E-mail / WhatsApp / push (via Resend e afins)
│   │   ├── billing-service/          # Assinatura da plataforma (Asaas/Stripe)
│   │   ├── ai-orchestrator-service/  # Orquestração LangGraph / agentes
│   │   └── admin-service/            # Super Admin da plataforma
│   ├── gateway/                      # API Gateway / BFF
│   └── shared/                       # Libs compartilhadas (types, auth middleware, tenant context, telemetry)
├── mobile/                # App mobile (React Native — preparado, entrega em fase posterior)
├── infra/
│   ├── docker/
│   ├── swarm/
│   ├── k8s/               # Manifests preparatórios para migração futura
│   └── ci-cd/
├── docs/
│   ├── prd/                # PRDs de módulo
│   └── spec/                # SPECs de módulo/serviço
└── package.json / turbo.json (ou nx.json)  # Gerenciamento de monorepo
```

**Ferramenta de monorepo:** Turborepo ou Nx (a decidir em SPEC de Fundação) — ambos compatíveis com Next.js/TypeScript e cache de build distribuído, essencial dado o número de serviços.

---

## 3. Arquitetura Multi-tenant

### 3.1 Estratégia de Isolamento de Dados
Modelo adotado: **banco compartilhado, schema compartilhado, com `tenant_id` obrigatório em toda tabela de domínio** (estratégia *shared database, shared schema, row-level isolation*), reforçado por:

- **Row-Level Security (RLS)** no PostgreSQL, com policy baseada em `tenant_id = current_setting('app.tenant_id')`, definida por sessão de conexão.
- **Middleware de contexto de tenant** obrigatório em todo request (extraído do token de autenticação/subdomínio), injetado no `AsyncLocalStorage`/contexto de execução do serviço antes de qualquer query.
- Nenhum repositório/DAO pode executar query sem tenant_id resolvido — enforced por lint/regra de code review e por teste automatizado de "tenant leakage".
- Tenants com necessidade de isolamento físico (grandes contas/compliance) podem ser promovidos a **schema dedicado** ou **banco dedicado** — arquitetura de dados preparada para essa promoção sem reescrever a aplicação (repository pattern abstrai a resolução de conexão por tenant).

### 3.2 Resolução de Tenant
- Landing page e portais: resolução por domínio/subdomínio (`tenant.moveai.com.br` ou domínio próprio configurado via Cloudflare API).
- Painel interno e API: resolução via claim `tenant_id` no token JWT emitido pelo Clerk (custom claims por organização).
- Agentes de IA: contexto de tenant propagado explicitamente em cada execução de grafo (LangGraph state).

### 3.3 Configuração por Tenant
Serviço `tenant-service` mantém:
- Metadados do tenant (nome, domínio, identidade visual, status, plano).
- Configurações de integração (chaves Asaas/Stripe do tenant, número de WhatsApp Business, credenciais de portais imobiliários).
- Feature flags e limites de uso por plano.

---

## 4. Backend — Arquitetura de Microserviços

### 4.1 Princípios
- Cada serviço possui seu próprio schema/domínio de dados; comunicação entre serviços nunca acessa banco de outro serviço diretamente.
- Comunicação síncrona: REST interno (JSON), com contratos versionados (OpenAPI por serviço).
- Comunicação assíncrona: eventos via **RabbitMQ** (padrão pub/sub e filas de trabalho), usados para: side-effects entre módulos (ex.: contrato assinado → gerar primeira cobrança), notificações, indexação para busca, gatilhos de agentes de IA.
- Idempotência obrigatória em consumidores de eventos (dedup por `event_id`).
- Cada serviço expõe `/health` (liveness/readiness) e métricas padronizadas.

### 4.2 Lista de Microserviços (mapeados aos módulos do PRD)

| Serviço | Módulo(s) do PRD | Responsabilidade |
|---|---|---|
| auth-service | Segurança/Identidade | Integração com Clerk, emissão/validação de contexto de sessão, RBAC |
| tenant-service | Multi-tenancy, Super Admin | CRUD de tenants, planos, configurações, feature flags |
| property-service | 7.1 | Imóveis (todos os tipos), mídia, histórico de status/preço |
| owner-service | 7.2 | Proprietários |
| customer-service | 7.3 | Clientes/Leads (perfil base) |
| broker-service | 7.4 | Corretores, comissionamento, metas |
| employee-service | 7.5 | Funcionários, permissões operacionais |
| scheduling-service | 7.6 | Agenda de visitas/vistorias/reuniões |
| crm-service | 7.7 | Funil, automações de follow-up, atribuição de leads |
| contract-service | 7.8 | Contratos, templates, ciclo de vida |
| financial-service | 7.9 | Contas a pagar/receber, repasses, comissões, cobrança (via Asaas) |
| rental-service | 7.10 | Ciclo de locação, reajuste, inadimplência |
| maintenance-service | 7.11 | Chamados de manutenção |
| document-service | 7.12 | Repositório documental, versionamento, integração de OCR |
| portal-service | 7.13, 7.14, 7.15 | BFF dos três portais externos |
| publishing-service | 7.16 | Integração/feed com portais imobiliários externos |
| notification-service | Transversal | Envio de e-mail (Resend), disparo de mensagens WhatsApp/Instagram |
| billing-service | Modelo de negócio (seção 4.3 do PRD) | Assinatura da plataforma (Asaas/Stripe), faturas dos tenants |
| ai-orchestrator-service | 8.1–8.8 | Orquestração dos agentes (LangGraph), gestão de conversas, tools |
| admin-service | 7.18 | Painel Super Admin, auditoria global, monitoramento |
| document-generation (via Gotenberg) | Transversal | Geração de PDFs (contratos, recibos, relatórios) — pode ser lib/serviço fino sobre o Gotenberg |

> Cada linha desta tabela origina, no mínimo, um SPEC de serviço próprio, detalhando modelo de dados, endpoints, eventos publicados/consumidos e SLAs internos.

### 4.3 API Gateway / BFF
- Ponto único de entrada para frontend web, mobile e landing pages.
- Responsabilidades: autenticação/autorização (validação de token Clerk), roteamento para microserviços, agregação de respostas (BFF), rate limiting, resolução de tenant.
- Tecnologia candidata: Node.js (Fastify/Express) ou gateway dedicado (ex.: Kong) — decisão registrada em SPEC de Fundação.

---

## 5. Frontend

### 5.1 Aplicação Principal (`/frontend`)
- **Next.js + React + TypeScript**, App Router.
- Multi-tenant no frontend: tema/identidade visual carregado dinamicamente por tenant (logo, cores, favicon) a partir do `tenant-service`.
- Áreas: Painel interno (gestão), Portal do Proprietário, Portal do Cliente, Portal do Corretor — podem ser sub-rotas do mesmo app ou apps federados (a decidir em SPEC de Fundação, considerando Module Federation/monorepo apps separados via Turborepo).
- Gerenciamento de estado/dados: React Query (ou equivalente) para cache de dados de servidor.
- Autenticação: Clerk (SDK React), com RBAC refletido na UI (feature gating por papel/plano).

### 5.2 Landing Pages (`/landingpage`)
- Next.js com SSG/ISR para performance e SEO por tenant.
- Renderização por domínio/subdomínio resolvido via middleware (Edge Middleware + Cloudflare).
- Chat embutido conectado ao `ai-orchestrator-service` (canal "Chat" da seção 8.1 do PRD).

### 5.3 Mobile (`/mobile`)
- Preparado desde a Fase 0, mas entregue em fase posterior (roadmap PRD seção 12).
- Recomenda-se **React Native** para reaproveitamento de lógica/tipos com o frontend web (monorepo, pacotes `shared`).
- Consome a mesma API Gateway; sem lógica de negócio duplicada.

---

## 6. Camada de Agentes de IA (AaaS)

### 6.1 Orquestração
- **LangGraph** como motor de orquestração de agentes, rodando dentro do `ai-orchestrator-service`.
- Cada capacidade da seção 8 do PRD é modelada como um **grafo** (ou nó reutilizável dentro de grafos maiores): atendimento, qualificação de leads, recomendação, geração de anúncios, OCR/análise documental, assistente interno, relatórios inteligentes, perfil do cliente.
- Estado do grafo inclui: `tenant_id`, canal, identidade do usuário final, histórico de conversa, contexto recuperado (RAG sobre dados do tenant).

### 6.2 Acesso a Dados (Tools)
- Agentes não acessam bancos de domínio diretamente: consomem os microserviços via **tools tipadas** (funções que chamam as APIs internas do property-service, crm-service, scheduling-service etc.), respeitando RBAC e tenant.
- Toda chamada de tool é registrada para auditoria (seção 9.4).

### 6.3 Canais de Entrada/Saída
| Canal | Integração |
|---|---|
| WhatsApp | Provedor de WhatsApp Business API (a definir provedor específico em SPEC de módulo — ex. Meta Cloud API ou BSP parceiro) |
| Instagram | Instagram Messaging API (Meta) |
| Chat (landing page/portal) | WebSocket/HTTP direto com `ai-orchestrator-service` |
| E-mail | Recebimento/envio via Resend (e provedor de recebimento, se necessário) |

- `notification-service` centraliza o envio efetivo (desacoplando o orquestrador do detalhe de cada provedor).

### 6.4 Escalonamento Humano (Handoff)
- Quando o agente identifica necessidade de intervenção humana, publica evento para `crm-service`/`broker-service` com contexto completo da conversa, permitindo ao corretor continuar sem perda de informação.

### 6.5 Modelo de Custos e Limites
- Consumo de IA (tokens/mensagens) medido por tenant no `ai-orchestrator-service`, reportado ao `billing-service` para enforcement de plano/add-ons.

---

## 7. Stack Tecnológica (consolidada)

| Camada | Tecnologia |
|---|---|
| Linguagem principal | TypeScript (frontend e backend Node.js) |
| Frontend Web | Next.js, React |
| Mobile | React Native (fase posterior) |
| Backend | Node.js (microserviços) |
| Orquestração de IA | LangGraph |
| Banco de dados relacional | PostgreSQL (multi-tenant via RLS) |
| Cache / filas leves | Redis |
| Mensageria / eventos | RabbitMQ |
| Autenticação/Identidade | Clerk |
| Pagamentos (nacional) | Asaas |
| Pagamentos (internacional/billing plataforma) | Stripe |
| DNS / Domínios / Edge | Cloudflare API |
| Infraestrutura/hospedagem | AtlasCloud |
| E-mail transacional | Resend |
| Geração de PDF | Gotenberg |
| Containers | Docker |
| Orquestração de containers | Docker Swarm (atual) → Kubernetes (preparado) |
| Logs estruturados | Pino |
| CI/CD | A definir ferramenta específica (ex. GitHub Actions) em SPEC de Fundação |

---

## 8. Modelo de Dados — Visão de Alto Nível

> Cada serviço detalha seu próprio schema em SPEC específico. Abaixo, entidades centrais e relacionamentos macro para orientar a modelagem.

### 8.1 Entidades-núcleo (transversais)
- `tenant` — id, nome, domínio, plano, status, configurações.
- `user` — id, tenant_id, papel (role), vínculo com Clerk (external_id).

### 8.2 Entidades de domínio (exemplos principais)
- `property` (imóvel) — tenant_id, tipo, endereço, características, status, owner_id(s).
- `owner` (proprietário) — tenant_id, dados pessoais/bancários.
- `customer` (cliente/lead) — tenant_id, dados pessoais, perfil de busca, origem.
- `broker` (corretor) — tenant_id, user_id, metas, regras de comissão.
- `employee` — tenant_id, user_id, cargo.
- `appointment` (agenda) — tenant_id, tipo (visita/vistoria/reunião), participantes, imóvel_id, status.
- `lead` / `deal` (CRM) — tenant_id, customer_id, funil/etapa, corretor_id, origem.
- `contract` — tenant_id, tipo, partes (owner/customer/broker), property_id, status, vigência.
- `financial_transaction` — tenant_id, tipo (receita/despesa/repasse/comissão), contract_id opcional, status, integração_asaas_id.
- `rental_cycle` — tenant_id, contract_id, competência, valor, status de pagamento, reajuste.
- `maintenance_request` — tenant_id, property_id, solicitante, status, prestador.
- `document` — tenant_id, entidade_relacionada (polimórfico: property/owner/customer/contract), tipo, versão, dados extraídos (OCR).
- `ai_conversation` — tenant_id, canal, customer_id, histórico, agente(s) envolvidos, resultado (lead qualificado, agendamento, etc.).

### 8.3 Relacionamentos macro
`tenant` 1—N todas as entidades acima → `property` N—N `owner` → `property` 1—N `contract` → `contract` 1—N `rental_cycle`/`financial_transaction` → `customer` 1—N `lead`/`ai_conversation` → `appointment` N—1 `property`, N—1 `broker`.

---

## 9. Segurança

### 9.1 Autenticação e Autorização
- **Clerk** para autenticação de usuários internos e externos (portais), incluindo MFA.
- **RBAC** granular por tenant: papéis padrão (seção 4.2 do PRD) + possibilidade de papéis customizados por tenant em fase futura.
- Tokens JWT de curta duração, com claims de `tenant_id` e `role`; refresh gerenciado pelo Clerk.

### 9.2 Proteção de Dados
- Criptografia em trânsito (TLS/HTTPS obrigatório, gerenciado via Cloudflare).
- Criptografia em repouso para dados sensíveis (documentos, dados bancários de proprietários, dados pessoais) — nível de banco (encryption at rest) + criptografia de campo específica para dados críticos (ex. dados bancários) usando envelope encryption.
- Conformidade **LGPD**: consentimento registrado, direito ao esquecimento (rotina de anonimização/expurgo), minimização de dados em logs.

### 9.3 Proteção de Aplicação
- **Rate limiting** por IP/tenant/usuário no API Gateway.
- Mitigação **OWASP Top 10**: validação de entrada em todos os serviços, prevenção de injection, proteção CSRF em formulários web, cabeçalhos de segurança (CSP, HSTS), gestão segura de segredos (vault/secret manager, nunca em código).
- **Honeypot** em formulários públicos (landing pages, formulário de lead) para mitigação de bots/spam antes mesmo do rate limiting.
- Segregação entre tenants reforçada em múltiplas camadas (aplicação + RLS no banco — seção 3.1), com testes automatizados específicos de "tenant isolation" no pipeline de CI.

### 9.4 Auditoria
- Log de auditoria imutável para: ações administrativas sensíveis, alterações de contrato/financeiro, acessos e decisões de agentes de IA (o que foi lido, o que foi decidido, ação tomada).
- Auditoria acessível ao Super Admin (visão global) e ao Admin do Tenant (visão restrita ao próprio tenant).

---

## 10. Observabilidade

| Prática | Ferramenta/Abordagem |
|---|---|
| Logs estruturados | Pino, com `tenant_id`, `request_id`, `trace_id` em todo log |
| Health checks | Endpoint `/health` (liveness/readiness) em cada serviço |
| Tracing distribuído | Propagação de `trace_id` entre serviços e para chamadas de IA (padrão OpenTelemetry recomendado) |
| Auditoria | Ver seção 9.4 |
| Dashboards | Visão operacional por tenant e visão consolidada da plataforma (Super Admin) |
| Alertas | Baseados em métricas de saúde (erro, latência, fila RabbitMQ acumulando, falhas de integração externa) |

---

## 11. Infraestrutura e Deploy

### 11.1 Containerização
- Cada microserviço, o gateway e as aplicações frontend possuem seu próprio `Dockerfile` multi-stage (build otimizado, imagem final mínima).

### 11.2 Orquestração
- **Docker Swarm** como orquestrador inicial (menor complexidade operacional para o estágio atual do produto).
- Arquitetura desenhada para ser **Kubernetes-ready**: manifests equivalentes mantidos em `/infra/k8s` desde o início, mesmo que não utilizados em produção imediatamente; serviços stateless, configuração via variáveis de ambiente/secret manager (12-factor app).

### 11.3 Hospedagem
- **AtlasCloud** como provedor de infraestrutura (compute), com **Cloudflare** na borda para DNS, CDN, WAF e proteção DDoS, incluindo gestão de domínios customizados por tenant (Cloudflare API — seção 9 do PRD).

### 11.4 CI/CD
- Pipeline por serviço: lint → testes unitários → testes de integração (incluindo testes de isolamento multi-tenant) → build de imagem → publicação em registry → deploy automatizado (ambiente de staging) → promoção manual/gate para produção.
- Versionamento semântico por serviço; monorepo com build/deploy seletivo (apenas serviços alterados, aproveitando cache do Turborepo/Nx).

### 11.5 Backup e Recuperação
- Backup automatizado do PostgreSQL (completo + incremental), com retenção definida por política (a detalhar em SPEC de Fundação/Compliance).
- Backup de documentos armazenados (document-service) replicado geograficamente.
- Plano de disaster recovery com RPO/RTO definidos em SPEC de Fundação.

### 11.6 Escalabilidade
- Escalabilidade horizontal por serviço (réplicas independentes conforme carga).
- Filas RabbitMQ absorvem picos de eventos (ex. picos de mensagens de IA), evitando sobrecarga síncrona nos serviços de domínio.
- Redis para cache de leitura frequente (ex. inventário de imóveis disponíveis) e para filas de curtíssimo prazo/rate limiting.

---

## 12. Comunicação Assíncrona — Eventos (visão inicial)

> Lista inicial de eventos-chave; cada SPEC de serviço detalha o payload e os contratos completos.

| Evento | Publicado por | Consumido por |
|---|---|---|
| `property.created` / `property.updated` | property-service | publishing-service, ai-orchestrator-service, portal-service |
| `lead.created` | crm-service, ai-orchestrator-service | broker-service, notification-service |
| `contract.signed` | contract-service | financial-service, notification-service, document-service |
| `payment.received` / `payment.overdue` | financial-service (via Asaas) | rental-service, notification-service, ai-orchestrator-service |
| `maintenance_request.created` | maintenance-service | owner (via portal-service), notification-service |
| `ai_conversation.handoff_requested` | ai-orchestrator-service | crm-service, broker-service, notification-service |
| `document.uploaded` | document-service | ai-orchestrator-service (OCR/análise) |

---

## 13. Padrões de API

- REST interno entre serviços; possibilidade de GraphQL no BFF/Gateway para o frontend, caso a agregação de dados de múltiplos serviços se torne complexa (avaliar em SPEC de Fundação).
- Versionamento de API por path (`/v1/...`) em todos os serviços expostos.
- Contratos documentados via OpenAPI, publicados internamente para geração de clients tipados (TypeScript) consumidos pelo frontend e por outros serviços.
- Paginação, filtros e ordenação padronizados (padrão único reutilizado por todos os serviços de listagem).

---

## 14. Estratégia de Testes

- Testes unitários por serviço (regras de negócio isoladas).
- Testes de integração por serviço (banco real/containerizado em pipeline).
- Testes de contrato entre serviços (garantindo compatibilidade de API/eventos).
- Testes específicos de **isolamento multi-tenant** (garantir que nenhuma query/rota vaza dados entre tenants) — obrigatórios no pipeline de CI antes de qualquer merge.
- Testes end-to-end dos fluxos críticos (cadastro de imóvel → publicação → lead → qualificação por IA → agendamento → contrato → cobrança).

---

## 15. Convenções Gerais de Código (referência para SPECs de módulo)

- TypeScript estrito (`strict: true`) em todo o monorepo.
- Padrão de nomenclatura de eventos: `entidade.acao` (snake/dot case conforme exemplo da seção 12).
- Toda função de acesso a dado de domínio deve receber `tenant_id` explicitamente — nunca implícito/global.
- Erros padronizados (formato único de erro de API) para consumo previsível pelo frontend e pelos agentes de IA.

---

## 16. Rastreabilidade PRD → SPEC

| Módulo (PRD seção 7/8) | Serviço(s) (SPEC seção 4.2) | Documentos a gerar |
|---|---|---|
| 7.1 Imóveis | property-service | PRD-Property, SPEC-Property |
| 7.2 Proprietários | owner-service | PRD-Owner, SPEC-Owner |
| 7.3 Clientes | customer-service | PRD-Customer, SPEC-Customer |
| 7.4 Corretores | broker-service | PRD-Broker, SPEC-Broker |
| 7.5 Funcionários | employee-service | PRD-Employee, SPEC-Employee |
| 7.6 Agenda | scheduling-service | PRD-Scheduling, SPEC-Scheduling |
| 7.7 CRM | crm-service | PRD-CRM, SPEC-CRM |
| 7.8 Contratos | contract-service | PRD-Contract, SPEC-Contract |
| 7.9 Financeiro | financial-service | PRD-Financial, SPEC-Financial |
| 7.10 Aluguel | rental-service | PRD-Rental, SPEC-Rental |
| 7.11 Manutenção | maintenance-service | PRD-Maintenance, SPEC-Maintenance |
| 7.12 Documental | document-service | PRD-Document, SPEC-Document |
| 7.13–7.15 Portais | portal-service | PRD-Portals, SPEC-Portals |
| 7.16 Publicação | publishing-service | PRD-Publishing, SPEC-Publishing |
| 7.17 Landing Page | landingpage app | PRD-Landingpage, SPEC-Landingpage |
| 7.18 Super Admin | admin-service | PRD-Admin, SPEC-Admin |
| 8.1–8.8 Agentes de IA | ai-orchestrator-service | PRD-AI-Agents (um por capacidade), SPEC-AI-Orchestrator |
| Billing da plataforma | billing-service | PRD-Billing, SPEC-Billing |
| Fundação (auth, tenant, gateway, observabilidade, CI/CD) | auth-service, tenant-service, gateway | SPEC-Fundacao |

---

## 17. Próximos Passos

1. Validar este SPEC guarda-chuva com a equipe técnica.
2. Elaborar **SPEC-Fundacao** (Fase 0 do roadmap): decisões definitivas de ferramenta de monorepo, gateway, RLS, CI/CD, padrão de eventos.
3. Detalhar SPEC por serviço, seguindo a tabela de rastreabilidade (seção 16), em paralelo aos PRDs de módulo correspondentes.
4. Estabelecer os SLAs internos entre serviços (latência máxima, disponibilidade) antes do início da Fase 1.
