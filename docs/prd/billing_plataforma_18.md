# PRD Detalhado — Billing da Plataforma (Assinatura dos Tenants)

**Módulo:** MOD-BILLING
**Arquivo:** 18/20
**Prioridade:** P0
**Fase de Implementação:** 0/2 (Fundação → cobrança ativa na monetização)
**Serviço Backend:** billing-service (`backend/src/modules/billing`, monólito porta 3001)
**Tabelas Principais:** plans, plan_features, subscriptions, platform_invoices, usage_meters, billing_webhook_events
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** Este é o módulo que **fatura a Move AI** (não confundir com MOD-FIN, que é o financeiro *do tenant*). Cada imobiliária assina um plano (por faixa de imóveis geridos e/ou nº de agentes de IA ativos), pago via Stripe (cartão/assinatura recorrente) e/ou Asaas. Add-ons: canais extras de IA, volume de mensagens, armazenamento. O enforcement de limites por plano é o que sustenta o modelo de receita recorrente.

**Integração sistêmica.** Consome `tenant.created`/`tenant.activated` (MOD-AUTH). Recebe medições de uso do MOD-AI (mensagens/tokens) e MOD-IMOVEL (contagem de imóveis) para enforcement. Controla feature flags/limites lidos pelo `tenant-service` e usados por todos os módulos. Publica `subscription.activated`, `subscription.past_due`, `subscription.canceled`, `usage.limit_reached`.

**Escopo desta fase.** MVP: catálogo de planos + features/limites, assinatura via Stripe com webhook idempotente, faturas da plataforma, medição de uso e enforcement (soft/hard limit), suspensão por inadimplência (→ `tenant.suspended`). **Fora desta fase:** cobrança usage-based granular por token em tempo real (agrega por período), marketplace de add-ons self-service.

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-BILLING-01 | Catálogo de planos | Planos + features + limites por faixa | Must Have |
| MOD-BILLING-02 | Assinatura (Stripe) | Criar/gerir assinatura recorrente | Must Have |
| MOD-BILLING-03 | Webhook idempotente | Baixa de fatura/status via webhook Stripe | Must Have |
| MOD-BILLING-04 | Medição de uso | Contadores por tenant (imóveis, msgs IA, storage) | Must Have |
| MOD-BILLING-05 | Enforcement de limites | Soft (aviso) e hard (bloqueio) por plano | Must Have |
| MOD-BILLING-06 | Add-ons | Canais/volume extras cobrados | Should Have |

## 3. Critérios de Aceite

### [MOD-BILLING-03] — Webhook idempotente

**AC-01 (Happy Path)** — **Dado** uma assinatura, **Quando** chega `invoice.paid` do Stripe com `event.id` novo, **Então** faz upsert por `event.id`, marca fatura paga, mantém tenant ACTIVE (200).
**AC-02 (Idempotência)** — **Dado** o mesmo `event.id` reenviado, **Quando** chega, **Então** não reprocessa (upsert no-op), 200.
**AC-03 (Edge Case — falha de pagamento)** — **Dado** `invoice.payment_failed`, **Quando** chega, **Então** marca `PAST_DUE`, inicia régua e, após D+X, publica `tenant.suspended`.

### [MOD-BILLING-05] — Enforcement de limites

**AC-01 (Soft limit)** — **Dado** um tenant a 90% do limite de imóveis do plano, **Quando** cria imóvel, **Então** permite mas publica `usage.limit_reached` (aviso de upgrade).
**AC-02 (Hard limit)** — **Dado** um tenant no 100% do limite, **Quando** tenta exceder, **Então** `403` `ERR_BILLING_006` "Limite do plano atingido — faça upgrade".
**AC-03 (Edge Case — downgrade)** — **Dado** um tenant que faz downgrade abaixo do uso atual, **Quando** aplica, **Então** bloqueia novas criações mas **não** apaga dados existentes (grace period + aviso).

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| plans | id, name, price, interval | — | ✓ | Catálogo global (não por tenant) |
| plan_features | plan_id, feature, limit_value | — | ✓ | Limites (max_properties, max_ai_msgs...) |
| subscriptions | tenant_id, id | String | ✓ | Assinatura do tenant |
| subscriptions | plan_id, status, stripe_subscription_id, current_period_end | — | ✓ | Estado |
| platform_invoices | tenant_id, id, amount, status, stripe_invoice_id, due_date | — | ✓ | Faturas da plataforma |
| usage_meters | tenant_id, metric, period, value | — | ✓ | Medição por período |
| billing_webhook_events | event_id (unique), processed_at, payload | — | ✓ | Idempotência |
| addons | tenant_id, type, quantity, price | — | — | Add-ons contratados |

### Campos com Criptografia AES-256-GCM
| Campo | Tabela | Justificativa |
|---|---|---|
| stripe_subscription_id, stripe_invoice_id | subscriptions/invoices | Referências de terceiro (segredo operacional) |

### Índices
```sql
CREATE UNIQUE INDEX idx_sub_tenant ON subscriptions(tenant_id);
CREATE UNIQUE INDEX idx_billing_webhook ON billing_webhook_events(event_id);
CREATE INDEX idx_usage_tenant_metric ON usage_meters(tenant_id, metric, period);
CREATE INDEX idx_platform_inv_tenant ON platform_invoices(tenant_id, status);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/plans | público/autenticado | Catálogo |
| GET | /v1/billing/subscription | ADMIN | Assinatura do tenant |
| POST | /v1/billing/subscribe | ADMIN | Assinar/trocar plano |
| POST | /v1/billing/addons | ADMIN | Contratar add-on |
| GET | /v1/billing/invoices | ADMIN | Faturas |
| GET | /v1/billing/usage | ADMIN | Uso vs limites |
| POST | /v1/webhooks/stripe | público (assinatura) | Webhook |
| GET | /v1/admin/subscriptions | SUPER_ADMIN | Todas as assinaturas (MOD-SADMIN) |

```typescript
export const SubscribeSchema = z.object({
  planId: z.string(),
  paymentMethodId: z.string(), // token Stripe
})
export const StripeWebhookSchema = z.object({
  id: z.string(), type: z.string(), data: z.object({ object: z.record(z.any()) }),
})
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_BILLING_001 | 404 | Plano/assinatura não encontrado |
| ERR_BILLING_002 | 422 | Inválido |
| ERR_BILLING_003 | 403 | Papel insuficiente |
| ERR_BILLING_004 | 409 | Assinatura já existe / estado inválido |
| ERR_BILLING_005 | 401 | Webhook não autenticado |
| ERR_BILLING_006 | 403 | Limite do plano atingido |

## 6. Máquinas de Estado

### Subscription — Status

```
TRIALING ──(invoice.paid)──► ACTIVE ──(payment_failed)──► PAST_DUE ──(régua D+X)──► SUSPENDED
    │                           │                             │                        │
    │(trial expira sem pgto)    │(cancela)                    │(paga)                   │(cancela definitivo)
    ▼                           ▼                             ▼                        ▼
 SUSPENDED                  CANCELED                       ACTIVE                   CANCELED
```

| De | Para | Evento | Efeito | Audit |
|---|---|---|---|---|
| TRIALING | ACTIVE | `subscription.activated` | libera limites do plano | ✓ |
| ACTIVE | PAST_DUE | `subscription.past_due` | régua de cobrança da plataforma | ✓ |
| PAST_DUE | SUSPENDED | `tenant.suspended` | bloqueia tenant (MOD-AUTH) | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Webhook idempotente por `event.id` | Upsert, nunca dupla baixa | — |
| RN-02 | Suspensão por inadimplência → tenant SUSPENDED | Publica `tenant.suspended` | MOD-AUTH |
| RN-03 | Downgrade não apaga dados; bloqueia novas criações | Grace period | Todos |
| RN-04 | Enforcement lê limites via cache do plano | Soft/hard limit | Todos |
| RN-05 | Uso de IA medido pelo MOD-AI é agregado por período | Reconciliação de fatura | MOD-AI |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `subscription.activated` | billing | auth (libera), admin | `{ tenantId, planId, timestamp }` |
| `subscription.past_due` | billing | notification, admin | `{ tenantId, invoiceId, timestamp }` |
| `tenant.suspended` | billing | auth, todos | `{ tenantId, reason:'billing', timestamp }` |
| `usage.limit_reached` | billing | notification | `{ tenantId, metric, value, limit }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin Tenant | Gestor | Financeiro |
|---|---|---|---|---|
| Ver planos | ✓ | ✓ | ✓ | ✓ |
| Assinar/trocar | ✓ | ✓ | — | — |
| Ver todas assinaturas | ✓ | — | — | — |

### Audit Log
`subscription.created/changed/canceled`, `invoice.paid`, `tenant.suspended`, `plan.limit_enforced`.

### Dados Pessoais (LGPD)
Dados de pagamento da imobiliária (não do consumidor final) tokenizados no Stripe — plataforma **não** armazena PAN. Retenção fiscal 5 anos.

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Limites do plano do tenant | 600s | `plan:limits:{tenantId}` | subscription.changed |
| Contadores de uso | 60s | `usage:{tenantId}:{metric}` | medição |

### Métricas
- `mrr`: receita recorrente mensal (consolidada — Super Admin).
- `churn_rate`: cancelamentos/mês.
- `tenants_past_due`: tenants inadimplentes.
- `plan_limit_hits`: quantas vezes limites são atingidos (sinal de upsell).

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Estrutura de planos e preços definitiva | Receita | PM/Founders | Antes monetização |
| 2 | Stripe vs Asaas para assinatura da plataforma | Cobrança | Tech Lead/Financeiro | Fase 0 |
| 3 | Cobrança usage-based de IA em tempo real ou por período? | Complexidade | Tech Lead | Fase 4 |
