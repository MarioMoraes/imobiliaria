# PRD Detalhado — Agenda (Visitas, Vistorias e Reuniões)

**Módulo:** MOD-AGENDA
**Arquivo:** 07/20
**Prioridade:** P1
**Fase de Implementação:** 1 (Core de Gestão)
**Serviço Backend:** scheduling-service (`backend/src/modules/scheduling`, monólito porta 3001)
**Tabelas Principais:** appointments, appointment_participants, calendar_blocks, availability_slots, inspection_items
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** A agenda organiza os três eventos operacionais críticos: **visita** a imóvel, **vistoria** de entrada/saída e **reunião** com proprietário/cliente. Sem controle de conflitos e lembretes automáticos, a imobiliária perde visitas (no-show) e comete erros de agendamento duplo — impacto direto na conversão e na experiência.

**Integração sistêmica.** Consome MOD-IMOVEL (imóvel do evento), MOD-CORRETOR (agenda do corretor), MOD-CLIENTE (participante). O agente de IA (MOD-AI) agenda visitas via tool; confirmação/lembrete sai pelo `notification-service` (MOD-NOTIF). Vistorias vinculam-se ao contrato (MOD-CONTRATO/MOD-RENTAL). Publica `appointment.created`, `appointment.confirmed`, `appointment.canceled`.

**Escopo desta fase.** MVP: agendamento por corretor/equipe com **bloqueio de conflito**, tipos (visita/vistoria/reunião), confirmação e lembretes automáticos, disponibilidade por corretor, recorrência via **RRULE (iCal RFC 5545)**, checklist de itens de vistoria. **Fora desta fase:** sincronização bidirecional com Google Calendar (só export .ics no MVP), otimização de rota entre visitas.

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-AGENDA-01 | Agendamento com anti-conflito | Cria evento validando janela livre do corretor | Must Have |
| MOD-AGENDA-02 | Tipos de evento | VISITA, VISTORIA_ENTRADA, VISTORIA_SAIDA, REUNIAO | Must Have |
| MOD-AGENDA-03 | Confirmação e lembretes | Lembrete automático (WhatsApp/email) T-24h e T-2h | Must Have |
| MOD-AGENDA-04 | Disponibilidade do corretor | Blocos de indisponibilidade + janela de atendimento | Must Have |
| MOD-AGENDA-05 | Recorrência (RRULE) | Turmas/blocos recorrentes padrão iCal | Should Have |
| MOD-AGENDA-06 | Checklist de vistoria | Itens vistoriados com estado e fotos | Should Have |
| MOD-AGENDA-08 | Catálogo de itens de vistoria | Lista editável por tenant (Pintura externa, Piso…) que alimenta o checklist | Should Have |
| MOD-AGENDA-07 | Export .ics | Exportar evento para calendário externo | Nice to Have |

## 3. Critérios de Aceite

### [MOD-AGENDA-01] — Anti-conflito

**AC-01 (Happy Path)** — **Dado** corretor A livre das 14h-15h, **Quando** `POST /v1/appointments` para visita nesse horário, **Então** cria `status=AGENDADO`, publica `appointment.created`, dispara lembretes (201).
**AC-02 (Conflito)** — **Dado** corretor A já com evento 14h-15h, **Quando** agenda outro sobreposto, **Então** `409` `ERR_AGENDA_004` "Conflito de horário para o corretor".
**AC-03 (Edge Case — concorrência)** — **Dado** dois pedidos simultâneos para o mesmo slot do corretor, **Quando** ambos chegam, **Então** lock por (corretor, janela) garante que só um cria; o outro recebe `409`.

### [MOD-AGENDA-03] — Confirmação e lembretes

**AC-01 (Happy Path)** — **Dado** um evento em 24h, **Quando** o job de lembrete roda, **Então** envia lembrete pelo canal preferido do cliente (WhatsApp > email) e registra envio.
**AC-02 (Cancelamento)** — **Dado** um cliente que responde "cancelar", **Quando** MOD-AI processa, **Então** `appointment` vira `CANCELADO`, libera o slot, notifica o corretor.
**AC-03 (Edge Case — no-show)** — **Dado** evento cujo horário passou sem check-in, **Quando** o job pós-evento roda, **Então** marca `NO_SHOW` e registra na timeline do cliente (MOD-CLIENTE).

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| appointments | tenant_id, id | String | ✓ | Isolamento / PK |
| appointments | type | Enum | ✓ | VISITA, VISTORIA_ENTRADA, VISTORIA_SAIDA, REUNIAO |
| appointments | property_id | String | — | Imóvel (obrigatório p/ visita/vistoria) |
| appointments | broker_id | String | ✓ | Corretor responsável |
| appointments | customer_id | String | — | Cliente participante |
| appointments | contract_id | String | — | Contrato (vistorias) |
| appointments | starts_at, ends_at | Timestamp | ✓ | Janela |
| appointments | status | Enum | ✓ | AGENDADO, CONFIRMADO, REALIZADO, CANCELADO, NO_SHOW |
| appointments | rrule | String | — | Recorrência RFC 5545 |
| appointment_participants | appointment_id, participant_type, participant_id | — | ✓ | Owner/customer/broker |
| calendar_blocks | broker_id, starts_at, ends_at, reason | — | ✓ | Indisponibilidade |
| inspection_items | appointment_id, catalog_item_id, item, condition, photos[] | — | — | Checklist de vistoria (item pode vir do catálogo) |
| inspection_item_catalog | tenant_id, id, description, active | — | ✓ | **Catálogo editável por tenant** de itens padrão de vistoria (Pintura externa, Piso, Louças…). Espelha a tela legada "Itens de Vistoria" |

### Índices
```sql
CREATE INDEX idx_appts_tenant ON appointments(tenant_id);
CREATE INDEX idx_appts_broker_window ON appointments(broker_id, starts_at, ends_at);
CREATE INDEX idx_appts_tenant_status ON appointments(tenant_id, status);
CREATE INDEX idx_blocks_broker ON calendar_blocks(broker_id, starts_at, ends_at);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/appointments | ADMIN, GESTOR, CORRETOR(próprios) | Listar (filtro por corretor/data/tipo) |
| POST | /v1/appointments | ADMIN, GESTOR, CORRETOR, AI_AGENT | Criar |
| GET | /v1/appointments/:id | idem | Detalhe |
| PATCH | /v1/appointments/:id | idem | Reagendar/atualizar |
| POST | /v1/appointments/:id/confirm | idem + Portal(cliente) | Confirmar |
| POST | /v1/appointments/:id/cancel | idem + Portal(cliente) | Cancelar |
| POST | /v1/appointments/:id/inspection | CORRETOR, GESTOR | Registrar checklist de vistoria |
| GET | /v1/brokers/:id/availability | ADMIN, GESTOR, CORRETOR, AI_AGENT | Slots livres |

```typescript
export const CreateAppointmentSchema = z.object({
  type: z.enum(['VISITA','VISTORIA_ENTRADA','VISTORIA_SAIDA','REUNIAO']),
  propertyId: z.string().optional(),
  brokerId: z.string(),
  customerId: z.string().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  rrule: z.string().optional(),
}).refine(d => !['VISITA','VISTORIA_ENTRADA','VISTORIA_SAIDA'].includes(d.type) || d.propertyId,
  { message: 'propertyId obrigatório p/ visita/vistoria' })
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_AGENDA_001 | 404 | Não encontrado |
| ERR_AGENDA_002 | 422 | Inválido |
| ERR_AGENDA_003 | 403 | Papel insuficiente |
| ERR_AGENDA_004 | 409 | Conflito de horário |

## 6. Máquinas de Estado

### Appointment — Status

```
AGENDADO ──(cliente confirma)──► CONFIRMADO ──(check-in/realizado)──► REALIZADO
    │                                │
    ├──(cancelar)──► CANCELADO       ├──(cancelar)──► CANCELADO
    │                                │
    └──(horário passou s/ ação)──► NO_SHOW ◄────────┘
```

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| — | AGENDADO | `appointment.created` | cliente + corretor (WhatsApp/email) | ✓ |
| AGENDADO | CONFIRMADO | `appointment.confirmed` | corretor | ✓ |
| * | CANCELADO | `appointment.canceled` | ambos + libera slot | ✓ |
| CONFIRMADO | NO_SHOW | `appointment.no_show` | corretor + timeline cliente | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Anti-conflito por corretor | Nenhuma sobreposição de janela | MOD-CORRETOR |
| RN-02 | Vistoria exige contrato vinculado | Valida `contract_id` p/ tipo vistoria | MOD-CONTRATO |
| RN-03 | Lembretes T-24h e T-2h | Jobs cron; canal por preferência do cliente | MOD-CRON, MOD-NOTIF |
| RN-04 | Cancelamento libera slot imediatamente | Slot volta a disponível | MOD-CRM |
| RN-05 | Recorrência gera ocorrências sob demanda | Expande RRULE por janela consultada | — |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `appointment.created` | scheduling | notification, crm | `{ tenantId, appointmentId, brokerId, startsAt }` |
| `appointment.confirmed` | scheduling | notification | `{ tenantId, appointmentId }` |
| `appointment.canceled` | scheduling | notification, crm | `{ tenantId, appointmentId, reason }` |
| `appointment.no_show` | scheduling | crm, ai-orchestrator | `{ tenantId, appointmentId, customerId }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Corretor | AI_AGENT | Portal(Cliente) |
|---|---|---|---|---|---|---|
| Listar | ✓ | ✓ | ✓ | próprios | via tool | próprios |
| Criar | ✓ | ✓ | ✓ | ✓ | ✓ | solicitar |
| Confirmar/Cancelar | ✓ | ✓ | ✓ | próprios | ✓ | próprios |
| Registrar vistoria | ✓ | ✓ | ✓ | ✓ | — | — |

### Audit Log
`appointment.created/canceled/no_show`, `inspection.recorded`.

### Dados Pessoais (LGPD)
Vincula cliente/corretor a horários e imóveis; base legal execução de contrato. Fotos de vistoria = evidência contratual; retenção pela vigência do contrato + 5 anos.

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Slots livres do corretor (dia) | 60s | `avail:{tenantId}:{brokerId}:{date}` | create/cancel/block |

### Métricas
- `no_show_rate`: % NO_SHOW por tenant/corretor.
- `visits_scheduled`: visitas agendadas/dia.
- `reminder_delivery_rate`: entrega de lembretes por canal.

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Sincronização bidirecional Google Calendar em qual fase? | Produtividade corretor | PM | Fase 3 |
| 2 | Política de reagendamento (nº máximo) por tenant? | Operação | PM | Fase 2 |
