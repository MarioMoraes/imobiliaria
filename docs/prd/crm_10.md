# PRD Detalhado — CRM Imobiliário (Funil, Leads e Automações)

**Módulo:** MOD-CRM
**Arquivo:** 10/20
**Prioridade:** P0
**Fase de Implementação:** 2 (Operação)
**Serviço Backend:** crm-service (`backend/src/modules/crm`, monólito porta 3001)
**Tabelas Principais:** pipelines, pipeline_stages, deals, deal_activities, lead_routing_rules, followup_automations
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** O CRM é onde o lead vira negócio. Funil configurável (Kanban), atribuição de leads a corretores, SLA de resposta e automação de follow-up são o que impede leads de "esfriarem". A **atribuição automática round-robin** (decisão de negócio) garante distribuição justa e resposta rápida — inclusive fora do horário comercial, via IA.

**Integração sistêmica.** Consome MOD-CLIENTE (o lead), MOD-CORRETOR (round-robin), MOD-IMOVEL (imóvel de interesse). Integração nativa com MOD-AI: leads qualificados pelo agente entram aqui; handoff da IA cria/atualiza deal. Publica `lead.created`, `deal.stage_changed`, `deal.won`, `deal.lost`.

**Escopo desta fase.** MVP: pipeline configurável por tenant, deals com etapas, atribuição round-robin automática, SLA de resposta com alerta, automações de follow-up, timeline de atividades. **Fora desta fase:** lead scoring por IA (fica no MOD-AI 8.8), automações condicionais complexas (workflow builder visual).

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-CRM-01 | Pipeline configurável (Kanban) | Etapas customizáveis por tenant | Must Have |
| MOD-CRM-02 | Gestão de deals | Negócio com cliente, imóvel, corretor, etapa | Must Have |
| MOD-CRM-03 | Atribuição round-robin | Distribuição automática de leads a corretores | Must Have |
| MOD-CRM-04 | SLA de resposta | Alerta se lead sem 1ª resposta em X min | Must Have |
| MOD-CRM-05 | Automação de follow-up | Tarefas/mensagens agendadas por etapa | Should Have |
| MOD-CRM-06 | Timeline de atividades | Histórico de interações do deal | Must Have |

## 3. Critérios de Aceite

### [MOD-CRM-03] — Atribuição round-robin

**AC-01 (Happy Path)** — **Dado** um `lead.created` (do site/IA) sem regra específica, **Quando** o CRM processa, **Então** cria deal na 1ª etapa e atribui ao próximo corretor DISPONIVEL do rodízio, publica `deal.assigned` (notifica corretor).
**AC-02 (Regra específica)** — **Dado** uma `lead_routing_rule` por região que casa, **Quando** o lead chega, **Então** atribui conforme a regra; se o corretor-alvo estiver indisponível, cai no round-robin da equipe.
**AC-03 (Edge Case — sem corretor)** — **Dado** nenhum corretor disponível, **Quando** o lead chega, **Então** o deal fica `NAO_ATRIBUIDO` numa fila e o gestor é alertado (sem perder o lead).

### [MOD-CRM-04] — SLA de resposta

**AC-01 (Happy Path)** — **Dado** um deal atribuído com SLA de 15min, **Quando** o corretor registra 1ª atividade em 10min, **Então** SLA cumprido, sem alerta.
**AC-02 (Violação)** — **Dado** SLA de 15min estourado sem resposta, **Quando** o job de SLA roda, **Então** publica `deal.sla_breached`, alerta corretor + gestor, e (opcional) reatribui.
**AC-03 (Edge Case — fora do horário)** — **Dado** lead fora do horário comercial, **Quando** o SLA é avaliado, **Então** o agente de IA responde imediatamente e o SLA humano só conta a partir da abertura do expediente.

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| pipelines | tenant_id, id, name, is_default | — | ✓ | Funil do tenant |
| pipeline_stages | pipeline_id, order, name, sla_minutes | — | ✓ | Etapas ordenadas |
| deals | tenant_id, id | String | ✓ | Isolamento / PK |
| deals | customer_id | String | ✓ | Cliente/lead |
| deals | property_id | String | — | Imóvel de interesse |
| deals | broker_id | String | — | Corretor atribuído |
| deals | pipeline_id, stage_id | String | ✓ | Posição no funil |
| deals | status | Enum | ✓ | ABERTO, GANHO, PERDIDO, NAO_ATRIBUIDO |
| deals | source | Enum | ✓ | Origem do lead |
| deals | first_response_at | Timestamp | — | Para SLA |
| deal_activities | deal_id, type, actor, notes, created_at | — | ✓ | Timeline |
| lead_routing_rules | tenant_id, criteria_json, target_type, target_id, priority | — | — | Regras de atribuição |
| followup_automations | tenant_id, stage_id, delay_minutes, action_json | — | — | Follow-up automático |

### Índices
```sql
CREATE INDEX idx_deals_tenant ON deals(tenant_id);
CREATE INDEX idx_deals_tenant_stage ON deals(tenant_id, stage_id, status);
CREATE INDEX idx_deals_broker ON deals(broker_id, status);
CREATE INDEX idx_deals_sla ON deals(tenant_id, first_response_at) WHERE status='ABERTO';
CREATE INDEX idx_activities_deal ON deal_activities(deal_id, created_at DESC);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/deals | ADMIN, GESTOR, CORRETOR(próprios) | Listar/board |
| POST | /v1/deals | ADMIN, GESTOR, CORRETOR, AI_AGENT | Criar |
| PATCH | /v1/deals/:id/stage | idem | Mover de etapa |
| POST | /v1/deals/:id/assign | ADMIN, GESTOR | Reatribuir |
| POST | /v1/deals/:id/activities | idem + AI_AGENT | Registrar atividade |
| POST | /v1/deals/:id/win | ADMIN, GESTOR, CORRETOR | Marcar ganho |
| POST | /v1/deals/:id/lost | idem | Marcar perdido (motivo) |
| GET/POST | /v1/pipelines | ADMIN, GESTOR | Gerir funil |

```typescript
export const CreateDealSchema = z.object({
  customerId: z.string(),
  propertyId: z.string().optional(),
  pipelineId: z.string().optional(), // default do tenant
  source: z.enum(['WHATSAPP','INSTAGRAM','SITE','PORTAL','INDICACAO','MANUAL']),
})
export const MoveStageSchema = z.object({ stageId: z.string(), notes: z.string().optional() })
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_CRM_001 | 404 | Não encontrado |
| ERR_CRM_002 | 422 | Inválido |
| ERR_CRM_003 | 403 | Papel insuficiente |
| ERR_CRM_004 | 409 | Transição de etapa inválida |

## 6. Máquinas de Estado

### Deal — Status/Etapa

```
NAO_ATRIBUIDO ──(round-robin)──► ABERTO(etapa 1) ──► ABERTO(etapa N) ──► GANHO
      ▲                              │                                     │
      │(sem corretor)                └──(perdido, motivo)──► PERDIDO       └─(gera contrato → MOD-CONTRATO)
```

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| — | ABERTO | `lead.created`+`deal.assigned` | corretor | ✓ |
| ABERTO | (nova etapa) | `deal.stage_changed` | — | ✓ |
| ABERTO | GANHO | `deal.won` | gestor; sugere criar contrato | ✓ |
| ABERTO | PERDIDO | `deal.lost` | — (analytics) | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Round-robin pula corretor indisponível | Mantém ordem | MOD-CORRETOR |
| RN-02 | Lead sem corretor não se perde | Fila NAO_ATRIBUIDO + alerta gestor | — |
| RN-03 | SLA fora do expediente conta a partir da abertura | IA cobre o gap | MOD-AI |
| RN-04 | Deal GANHO sugere criação de contrato | Não cria automático (revisão humana) | MOD-CONTRATO |
| RN-05 | Dedup de deal aberto por cliente+imóvel | Evita deals duplicados | MOD-CLIENTE |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `lead.created` | crm, ai-orchestrator | broker, notification | `{ tenantId, dealId, customerId, source }` |
| `deal.assigned` | crm | notification, broker | `{ tenantId, dealId, brokerId }` |
| `deal.stage_changed` | crm | ai-orchestrator (perfil) | `{ tenantId, dealId, from, to }` |
| `deal.won` / `deal.lost` | crm | ai-orchestrator, admin | `{ tenantId, dealId, reason? }` |
| `deal.sla_breached` | crm | notification | `{ tenantId, dealId, brokerId }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Corretor | AI_AGENT |
|---|---|---|---|---|---|
| Ver board | ✓ | ✓ | ✓ | próprios | via tool |
| Criar deal | ✓ | ✓ | ✓ | ✓ | ✓ |
| Reatribuir | ✓ | ✓ | ✓ | — | — |
| Gerir pipeline | ✓ | ✓ | ✓ | — | — |

### Audit Log
`deal.assigned/stage_changed/won/lost`, `routing_rule.updated`.

### Dados Pessoais (LGPD)
Deals referenciam cliente (dado pessoal via MOD-CLIENTE); atividades podem conter conteúdo de conversa. Retenção alinhada ao MOD-CLIENTE.

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Board do corretor | 30s | `board:{tenantId}:{brokerId}` | stage_changed/assigned |
| Ponteiro round-robin | estado | `rr:{tenantId}:{teamId}` | atribuição |

### Métricas
- `lead_response_time`: tempo médio 1ª resposta (por corretor/tenant).
- `funnel_conversion`: conversão por etapa (lead→visita→proposta→contrato).
- `sla_breach_rate`: % de leads com SLA estourado.

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Lead scoring por IA em qual fase (MOD-AI 8.8)? | Priorização | PM | Fase 4 |
| 2 | Reatribuição automática em SLA estourado: ligada por padrão? | Distribuição | PM | Fase 2 |
| 3 | Horário comercial configurável por tenant/corretor | SLA | PM | Fase 2 |
