# PRD Detalhado — Notificações & Alertas (Multicanal)

**Módulo:** MOD-NOTIF
**Arquivo:** 17/20
**Prioridade:** P0
**Fase de Implementação:** 0/2 (Transversal — base na Fundação, régua na Fase 2)
**Serviço Backend:** notification-service (`backend/src/modules/notification`, monólito porta 3001)
**Tabelas Principais:** alerts, alert_templates, notification_queue, notification_logs, channel_preferences
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** Quase todo evento relevante do sistema precisa avisar alguém: lembrete de visita, cobrança vencida, repasse executado, chamado de manutenção, handoff de IA. Centralizar o envio num único serviço (desacoplando cada módulo do detalhe de WhatsApp/Email/push) garante consistência, controle de preferência de canal e observabilidade de entrega. A **régua de cobrança** de inadimplência é a sequência de alertas mais crítica de negócio.

**Integração sistêmica.** Consumidor universal de eventos RabbitMQ (payment.overdue, appointment.created, contract.signed, transfer.executed, etc.). Envia via **Resend** (e-mail), provedor WhatsApp Business e in-app. Recebe do MOD-AI para mensagens conversacionais. Prioridade de canal: **WhatsApp > Email > In-app** (fallback se o anterior falhar).

**Escopo desta fase.** MVP: templates de alerta com variáveis, fila de notificação com retry/DLX, régua de cobrança configurável (D+0→D+30), logs de entrega, preferências de canal por destinatário, tracking de abertura/clique (e-mail via Resend). **Fora desta fase:** editor visual de templates, campanhas de marketing em massa, push mobile (fase mobile).

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-NOTIF-01 | Templates de alerta | Templates com variáveis `{{...}}` por evento/canal | Must Have |
| MOD-NOTIF-02 | Fila + retry (DLX) | Envio assíncrono resiliente com backoff | Must Have |
| MOD-NOTIF-03 | Régua de cobrança | Sequência D+0,1,3,7,15,30 de alertas de inadimplência | Must Have |
| MOD-NOTIF-04 | Prioridade/fallback de canal | WhatsApp > Email > In-app | Must Have |
| MOD-NOTIF-05 | Logs e tracking | Entrega, abertura, clique | Must Have |
| MOD-NOTIF-06 | Preferências de canal | Opt-in/out por destinatário e tipo | Should Have |

## 3. Critérios de Aceite

### [MOD-NOTIF-04] — Prioridade/fallback de canal

**AC-01 (Happy Path)** — **Dado** um destinatário com WhatsApp disponível, **Quando** há alerta, **Então** envia por WhatsApp e registra `DELIVERED`.
**AC-02 (Fallback)** — **Dado** falha de entrega no WhatsApp, **Quando** ocorre, **Então** faz fallback para e-mail (Resend); se falhar, in-app; registra a cadeia de tentativas.
**AC-03 (Edge Case — opt-out)** — **Dado** um destinatário que fez opt-out de marketing, **Quando** há alerta **transacional** (ex.: cobrança), **Então** ainda envia (transacional não é bloqueável); alerta de **marketing** é suprimido.

### [MOD-NOTIF-03] — Régua de cobrança

**AC-01 (Happy Path)** — **Dado** `payment.overdue`, **Quando** a régua roda em D+1/D+3/D+7/D+15/D+30, **Então** cada etapa envia mensagem de tom escalonado pelo canal preferido, registrando cada envio.
**AC-02 (Idempotência)** — **Dado** o job da régua reexecutado no mesmo dia, **Quando** roda, **Então** não reenvia a etapa já enviada (dedup por `eventId`+etapa).
**AC-03 (Edge Case — pagamento)** — **Dado** pagamento em D+5, **Quando** ocorre, **Então** cancela as etapas futuras da régua (D+7, D+15, D+30).

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| alerts | tenant_id, id | String | ✓ | Isolamento / PK |
| alerts | type | String | ✓ | Ex.: rental.overdue, appointment.reminder |
| alerts | recipient_type, recipient_id | String | ✓ | customer/owner/broker/user |
| alerts | channel | Enum | ✓ | WHATSAPP, EMAIL, IN_APP |
| alerts | status | Enum | ✓ | QUEUED, SENT, DELIVERED, OPENED, FAILED |
| alert_templates | tenant_id, type, channel, subject, body, variables[] | — | ✓ | Templates |
| notification_queue | id, alert_id, attempts, next_attempt_at, event_id | — | ✓ | Fila com retry |
| notification_logs | alert_id, channel, provider_id, result, timestamp | — | ✓ | Auditoria de entrega |
| channel_preferences | tenant_id, recipient_id, channel, category, opt_in | — | — | Preferências |

### Índices
```sql
CREATE INDEX idx_alerts_tenant_status ON alerts(tenant_id, status);
CREATE UNIQUE INDEX idx_queue_event ON notification_queue(event_id, alert_id);
CREATE INDEX idx_queue_next ON notification_queue(next_attempt_at) WHERE attempts < 5;
CREATE INDEX idx_notif_logs_alert ON notification_logs(alert_id, timestamp DESC);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/alerts | ADMIN, GESTOR | Listar (por tipo/status) |
| POST | /v1/alerts/send | serviços internos, ADMIN | Enfileirar alerta manual |
| GET/POST | /v1/alert-templates | ADMIN, GESTOR | Gerir templates |
| GET | /v1/notifications/logs | ADMIN, GESTOR | Logs de entrega |
| PATCH | /v1/channel-preferences | ADMIN, Portal(próprio) | Opt-in/out |
| POST | /v1/webhooks/resend | público (assinatura) | Tracking de abertura/clique |

```typescript
export const SendAlertSchema = z.object({
  type: z.string(),
  recipient: z.object({ type: z.enum(['CUSTOMER','OWNER','BROKER','USER']), id: z.string() }),
  variables: z.record(z.any()),
  preferredChannel: z.enum(['WHATSAPP','EMAIL','IN_APP']).optional(),
  category: z.enum(['TRANSACIONAL','MARKETING']).default('TRANSACIONAL'),
  eventId: z.string(), // idempotência
})
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_NOTIF_001 | 404 | Template/alerta não encontrado |
| ERR_NOTIF_002 | 422 | Inválido / variável faltante |
| ERR_NOTIF_003 | 403 | Papel insuficiente |
| ERR_NOTIF_004 | 409 | Alerta duplicado (mesmo eventId) |

## 6. Máquinas de Estado

### Alerta — Status

```
QUEUED ──(envio)──► SENT ──(callback provedor)──► DELIVERED ──(tracking)──► OPENED
   │                  │
   │                  └──(falha)──► FAILED ──(fallback canal)──► QUEUED(próximo canal)
   └──(retries esgotados em todos canais)──► FAILED (final)
```

| De | Para | Evento | Efeito | Audit |
|---|---|---|---|---|
| QUEUED | SENT | `notification.sent` | registra provider_id | ✓ |
| SENT | FAILED | `notification.failed` | tenta próximo canal | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Idempotência por `event_id`+etapa | Nunca envia duplicado | Todos publishers |
| RN-02 | Transacional ignora opt-out; marketing respeita | Distinção por `category` | LGPD |
| RN-03 | Fallback de canal em cascata | WhatsApp→Email→In-app | — |
| RN-04 | Régua cancela etapas ao pagar | Consome `payment.received` | MOD-FIN, MOD-RENTAL |
| RN-05 | Retry com backoff exponencial via DLX | 1s,5s,30s,5min | — |

## 8. Eventos RabbitMQ

| Evento consumido | Publisher | Ação |
|---|---|---|
| `payment.overdue` | financial | inicia régua de cobrança |
| `appointment.created` | scheduling | agenda lembretes T-24h/T-2h |
| `transfer.executed` | financial | avisa proprietário |
| `contract.signed` | contract | envia recibo/boas-vindas |
| `ai_conversation.handoff_requested` | ai | alerta corretor |

| Evento publicado | Consumers | Payload |
|---|---|---|
| `notification.sent` / `notification.failed` | admin | `{ tenantId, alertId, channel, result }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Portal(próprio) |
|---|---|---|---|---|
| Ver alertas | ✓ | ✓ | ✓ | próprios |
| Gerir templates | ✓ | ✓ | ✓ | — |
| Preferências de canal | ✓ | ✓ | — | próprias |

### Audit Log
`alert.sent/failed`, `template.updated`, `preference.changed`.

### Dados Pessoais (LGPD)
Mensagens contêm dado pessoal (nome, valores); logs retêm conteúdo mínimo. Opt-out de marketing respeitado; transacional é base legal execução de contrato. Retenção de logs 12 meses.

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Preferências de canal | 300s | `chpref:{tenantId}:{recipientId}` | preference.changed |
| Dedup de régua | até fim do ciclo | `dunning:{eventId}:{step}` | payment.received |

### Métricas
- `notifications_delivered`: entregas por canal/dia.
- `delivery_failure_rate`: % falhas por canal.
- `email_open_rate` / `click_rate`: engajamento (Resend).
- `dunning_recovery_rate`: % inadimplências recuperadas pela régua.

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Provedor WhatsApp Business (Meta Cloud vs BSP) | Custo, entregabilidade | Tech Lead | Fase 2 |
| 2 | Régua configurável por tenant vs global | Flexibilidade | PM | Fase 2 |
| 3 | Limite de mensagens por plano (add-on) | Billing | PM | Fase 2 |
