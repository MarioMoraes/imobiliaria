# PRD Detalhado — Landing Page Personalizada por Tenant

**Módulo:** MOD-LP
**Arquivo:** 16/20
**Prioridade:** P1
**Fase de Implementação:** 3 (Presença Digital)
**Serviço Backend:** landingpage app (Next.js SSG/ISR) + `backend/src/modules/landing` (monólito porta 3001)
**Tabelas Principais:** landing_pages, page_blocks, lead_forms, lead_submissions
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** Cada imobiliária ganha um site público próprio (`slug.officesai.com.br` ou domínio próprio) com sua marca, catálogo de imóveis, formulário de contato e **chat de IA embutido**. É a vitrine digital e a principal porta de captação de leads — precisa ser rápida (SEO/ISR), personalizável sem código e protegida contra spam.

**Integração sistêmica.** Resolve tenant por domínio/subdomínio (MOD-DNS/Cloudflare — tratado como parte deste módulo aqui). Catálogo vem de MOD-IMOVEL; leads entram no MOD-CRM (`lead.created`); chat conecta ao MOD-AI. Branding vem do `tenant_config` (MOD-AUTH). Publica `lead.created` (origem SITE).

**Escopo desta fase.** MVP: editor de conteúdo **baseado em blocos** (não drag-and-drop livre) — hero, catálogo/modalidades, sobre/equipe, depoimentos, contato, chat; formulário de lead com **honeypot anti-spam**; SSG/ISR por tenant; resolução por subdomínio. **Fora desta fase:** editor visual WYSIWYG completo, A/B testing, blog/CMS.

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-LP-01 | Editor por blocos | Blocos pré-definidos ordenáveis e configuráveis | Must Have |
| MOD-LP-02 | Catálogo público | Lista/detalhe de imóveis DISPONIVEL do tenant | Must Have |
| MOD-LP-03 | Formulário de lead + honeypot | Captura lead com proteção anti-bot | Must Have |
| MOD-LP-04 | Chat de IA embutido | Widget conectado ao MOD-AI | Should Have |
| MOD-LP-05 | Branding por tenant | Logo, cores, favicon do tenant_config | Must Have |
| MOD-LP-06 | SSG/ISR + SEO | Renderização estática com revalidação | Must Have |

## 3. Critérios de Aceite

### [MOD-LP-03] — Formulário de lead + honeypot

**AC-01 (Happy Path)** — **Dado** um visitante, **Quando** submete o formulário com nome+contato válidos e honeypot vazio, **Então** cria lead (via MOD-CLIENTE/CRM) com origem `SITE`, publica `lead.created`, exibe confirmação (201).
**AC-02 (Bot/spam)** — **Dado** um bot que preenche o campo honeypot (invisível), **Quando** submete, **Então** o backend **descarta silenciosamente** (retorna 200 falso-positivo p/ o bot) e **não** cria lead.
**AC-03 (Edge Case — rate limit)** — **Dado** submissões repetidas do mesmo IP, **Quando** excedem o limite, **Então** `429` `ERR_LP_005` "Muitas tentativas".

### [MOD-LP-01] — Editor por blocos

**AC-01 (Happy Path)** — **Dado** um ADMIN, **Quando** adiciona/reordena blocos (hero, catálogo, contato) e publica, **Então** a landing é regenerada (ISR) refletindo a nova ordem.
**AC-02 (Validação)** — **Dado** um bloco obrigatório removido (ex.: contato), **Quando** publica, **Então** `422` `ERR_LP_002` "Bloco de contato é obrigatório".

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| landing_pages | tenant_id, id | String | ✓ | Isolamento / PK |
| landing_pages | slug, custom_domain | String | ✓/— | Subdomínio / domínio próprio |
| landing_pages | status | Enum | ✓ | RASCUNHO, PUBLICADA |
| landing_pages | theme_json | JSONB | — | Overrides de branding |
| page_blocks | landing_page_id, type, order, config_json | — | ✓ | HERO, CATALOG, TEAM, TESTIMONIALS, CONTACT, CHAT |
| lead_forms | landing_page_id, id, fields_json | — | ✓ | Config do formulário |
| lead_submissions | tenant_id, form_id, payload, ip, honeypot_ok, created_at | — | ✓ | Submissões |

### Índices
```sql
CREATE UNIQUE INDEX idx_landing_slug ON landing_pages(slug);
CREATE UNIQUE INDEX idx_landing_domain ON landing_pages(custom_domain) WHERE custom_domain IS NOT NULL;
CREATE INDEX idx_blocks_page ON page_blocks(landing_page_id, "order");
CREATE INDEX idx_submissions_tenant ON lead_submissions(tenant_id, created_at DESC);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/landing | ADMIN, GESTOR | Config da landing do tenant |
| PATCH | /v1/landing | ADMIN, GESTOR | Atualizar blocos/tema |
| POST | /v1/landing/publish | ADMIN, GESTOR | Publicar (dispara ISR) |
| GET | /public/site/:slug | público | Dados de render (SSG/ISR) |
| GET | /public/site/:slug/properties | público | Catálogo público |
| POST | /public/site/:slug/lead | público (honeypot+rate limit) | Enviar lead |

```typescript
export const PublicLeadSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  message: z.string().max(1000).optional(),
  propertyId: z.string().optional(),
  _hp: z.string().max(0).optional(), // honeypot: deve vir vazio
}).refine(d => d.email || d.phone, { message: 'contato obrigatório' })
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_LP_001 | 404 | Página/slug não encontrado |
| ERR_LP_002 | 422 | Inválido / bloco obrigatório ausente |
| ERR_LP_003 | 403 | Papel insuficiente |
| ERR_LP_005 | 429 | Rate limit |

## 6. Máquinas de Estado

### Landing Page — Status

```
RASCUNHO ──(publish)──► PUBLICADA ──(editar)──► RASCUNHO(alterações) ──(republish)──► PUBLICADA
```

### Lead Submission

```
RECEBIDA ──(honeypot ok + rate ok)──► ACEITA → cria lead (CRM)
   │
   └──(honeypot preenchido / rate)──► DESCARTADA (silencioso)
```

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| RECEBIDA | ACEITA | `lead.created` | corretor (round-robin CRM) | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Honeypot descarta bot silenciosamente | Não revela detecção | Segurança |
| RN-02 | Catálogo público só imóveis DISPONIVEL | Filtro de status | MOD-IMOVEL |
| RN-03 | Publicar dispara revalidação ISR | Cache de página por tenant | — |
| RN-04 | Lead do site entra no round-robin do CRM | Origem SITE | MOD-CRM |
| RN-05 | Domínio próprio requer config DNS válida | Depende MOD-DNS | MOD-DNS |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `lead.created` | landing | crm, customer, notification | `{ tenantId, source:'SITE', payload, timestamp }` |
| `landing.published` | landing | — (ISR trigger) | `{ tenantId, landingId }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Público |
|---|---|---|---|---|
| Editar landing | ✓ | ✓ | ✓ | — |
| Publicar | ✓ | ✓ | ✓ | — |
| Ver site/enviar lead | ✓ | ✓ | ✓ | ✓ |

### Audit Log
`landing.published`, `lead.submitted` (com IP).

### Dados Pessoais (LGPD)
Formulário coleta dado pessoal do lead → exige aviso de privacidade/consentimento visível; base legal consentimento. IP retido 12 meses (segurança anti-spam).

## 10. Performance & Observabilidade

### Cache Redis / ISR
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Render da landing | ISR 300s | `lp:{slug}` | landing.published |
| Catálogo público | 120s | `lp:catalog:{tenantId}` | property.status_changed |

### Métricas
- `landing_visits`: visitas por tenant.
- `lead_conversion_rate`: leads / visitas.
- `spam_blocked`: submissões descartadas (honeypot/rate).

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Blocos disponíveis no MVP (lista final) | Escopo editor | PM | Fase 3 |
| 2 | Consentimento LGPD: texto padrão vs configurável | Compliance | PM/Jurídico | Fase 3 |
