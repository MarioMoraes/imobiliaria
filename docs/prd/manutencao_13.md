# PRD Detalhado — Gestão de Manutenção

**Módulo:** MOD-MAINT
**Arquivo:** 13/20
**Prioridade:** P1
**Fase de Implementação:** 2 (Operação)
**Serviço Backend:** maintenance-service (`backend/src/modules/maintenance`, monólito porta 3001)
**Tabelas Principais:** maintenance_requests, maintenance_approvals, service_providers, maintenance_history
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** Manutenção de imóveis locados é fonte de atrito entre inquilino, proprietário e imobiliária. Um fluxo estruturado — abertura pelo inquilino (portal/IA), aprovação do proprietário e execução por prestador — reduz demora, dá transparência e cria histórico por imóvel (valoriza o ativo e informa decisões futuras).

**Integração sistêmica.** Abertura via Portal do Cliente (MOD-PORTAL) ou agente de IA. Aprovação via Portal do Proprietário. Notificações via MOD-NOTIF. Custos podem gerar lançamentos no MOD-FIN (dedução do repasse). Vincula-se a MOD-IMOVEL (histórico). Publica `maintenance_request.created`, `maintenance.approved`, `maintenance.completed`.

**Escopo desta fase.** MVP: abertura de chamado com fotos, fluxo de aprovação do proprietário, cadastro de prestadores, execução e conclusão, histórico por imóvel. **Fora desta fase:** marketplace de prestadores, orçamento comparativo automático, integração com pagamento direto ao prestador.

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-MAINT-01 | Abertura de chamado | Inquilino/IA/interno abre com descrição+fotos | Must Have |
| MOD-MAINT-02 | Fluxo de aprovação | Proprietário aprova/recusa (acima de limite) | Must Have |
| MOD-MAINT-03 | Cadastro de prestadores | Prestadores de serviço por categoria | Should Have |
| MOD-MAINT-04 | Execução e conclusão | Atribuir prestador, acompanhar, concluir | Must Have |
| MOD-MAINT-05 | Histórico por imóvel | Linha do tempo de manutenções | Should Have |

## 3. Critérios de Aceite

### [MOD-MAINT-01] — Abertura

**AC-01 (Happy Path)** — **Dado** um inquilino no portal, **Quando** `POST /v1/maintenance-requests` com categoria, descrição e fotos, **Então** cria `ABERTO`, publica `maintenance_request.created`, notifica a imobiliária (201).
**AC-02 (Validação)** — **Dado** chamado sem descrição, **Quando** submete, **Então** `422` `ERR_MAINT_002`.
**AC-03 (Edge Case)** — **Dado** inquilino sem contrato vigente no imóvel, **Quando** abre chamado, **Então** `403` `ERR_MAINT_003` (só inquilino ativo abre para o imóvel).

### [MOD-MAINT-02] — Aprovação

**AC-01 (Happy Path)** — **Dado** um chamado com custo estimado acima do limite de alçada, **Quando** a imobiliária encaminha, **Então** vira `AGUARDANDO_APROVACAO` e notifica o proprietário no portal.
**AC-02 (Abaixo do limite)** — **Dado** custo abaixo do limite de alçada do tenant, **Quando** aberto, **Então** pula aprovação e vai direto a `APROVADO` (regra de alçada configurável).
**AC-03 (Edge Case — timeout)** — **Dado** proprietário sem resposta em N dias, **Quando** o job roda, **Então** escala ao gestor e registra a demora (SLA de aprovação).

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| maintenance_requests | tenant_id, id | String | ✓ | Isolamento / PK |
| maintenance_requests | property_id | String | ✓ | Imóvel |
| maintenance_requests | contract_id | String | — | Contrato vigente |
| maintenance_requests | opened_by | String | ✓ | Solicitante (customer/user) |
| maintenance_requests | category | Enum | ✓ | HIDRAULICA, ELETRICA, ESTRUTURAL, ELETRO, OUTRO |
| maintenance_requests | description | Text | ✓ | Descrição |
| maintenance_requests | photos | String[] | — | Evidências |
| maintenance_requests | estimated_cost | Decimal | — | Custo estimado |
| maintenance_requests | status | Enum | ✓ | ABERTO, AGUARDANDO_APROVACAO, APROVADO, RECUSADO, EM_EXECUCAO, CONCLUIDO, CANCELADO |
| maintenance_requests | provider_id | String | — | Prestador |
| maintenance_approvals | request_id, owner_id, decision, decided_at, notes | — | — | Aprovação |
| service_providers | tenant_id, id, name, category, contact | — | ✓ | Prestadores |
| maintenance_history | property_id, request_id, event, created_at | — | ✓ | Timeline |

### Índices
```sql
CREATE INDEX idx_maint_tenant_status ON maintenance_requests(tenant_id, status);
CREATE INDEX idx_maint_property ON maintenance_requests(property_id, created_at DESC);
CREATE INDEX idx_providers_tenant_cat ON service_providers(tenant_id, category);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/maintenance-requests | ADMIN, GESTOR, Portal(dono/inquilino) | Listar |
| POST | /v1/maintenance-requests | Portal(inquilino), GESTOR, AI_AGENT | Abrir |
| GET | /v1/maintenance-requests/:id | idem | Detalhe |
| POST | /v1/maintenance-requests/:id/approve | Portal(proprietário), GESTOR | Aprovar/recusar |
| POST | /v1/maintenance-requests/:id/assign | GESTOR | Atribuir prestador |
| POST | /v1/maintenance-requests/:id/complete | GESTOR, prestador | Concluir |
| GET/POST | /v1/service-providers | ADMIN, GESTOR | Prestadores |

```typescript
export const CreateMaintenanceSchema = z.object({
  propertyId: z.string(),
  category: z.enum(['HIDRAULICA','ELETRICA','ESTRUTURAL','ELETRO','OUTRO']),
  description: z.string().min(5),
  photos: z.array(z.string().url()).optional(),
})
export const ApprovalSchema = z.object({ decision: z.enum(['APROVAR','RECUSAR']), notes: z.string().optional() })
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_MAINT_001 | 404 | Não encontrado |
| ERR_MAINT_002 | 422 | Inválido |
| ERR_MAINT_003 | 403 | Sem vínculo ativo com imóvel |
| ERR_MAINT_004 | 409 | Transição de status inválida |

## 6. Máquinas de Estado

### Maintenance Request — Status

```
ABERTO ──(custo < alçada)──► APROVADO ──(atribui)──► EM_EXECUCAO ──► CONCLUIDO
   │                            ▲
   └─(custo ≥ alçada)──► AGUARDANDO_APROVACAO ──(proprietário aprova)──┘
                                │
                                └──(recusa)──► RECUSADO
```

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| — | ABERTO | `maintenance_request.created` | imobiliária | ✓ |
| ABERTO | AGUARDANDO_APROVACAO | `maintenance.approval_requested` | proprietário (portal) | ✓ |
| AGUARDANDO_APROVACAO | APROVADO | `maintenance.approved` | inquilino, prestador | ✓ |
| EM_EXECUCAO | CONCLUIDO | `maintenance.completed` | inquilino, proprietário; MOD-FIN (custo) | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Limite de alçada configurável por tenant | Abaixo dispensa aprovação | MOD-SADMIN (config) |
| RN-02 | Só inquilino ativo abre chamado do imóvel | Valida contrato vigente | MOD-CONTRATO |
| RN-03 | Custo concluído pode deduzir do repasse | Lançamento no MOD-FIN | MOD-FIN |
| RN-04 | SLA de aprovação com escalonamento | Job de timeout escala ao gestor | MOD-CRON, MOD-NOTIF |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `maintenance_request.created` | maintenance | notification, portal | `{ tenantId, requestId, propertyId, category }` |
| `maintenance.approved` | maintenance | notification | `{ tenantId, requestId, ownerId }` |
| `maintenance.completed` | maintenance | financial, notification | `{ tenantId, requestId, cost }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Corretor | Portal(Inquilino) | Portal(Proprietário) |
|---|---|---|---|---|---|---|
| Abrir | ✓ | ✓ | ✓ | — | ✓ | — |
| Aprovar | ✓ | ✓ | ✓ | — | — | ✓ (próprio imóvel) |
| Atribuir prestador | ✓ | ✓ | ✓ | — | — | — |
| Concluir | ✓ | ✓ | ✓ | — | — | — |

### Audit Log
`maintenance.created/approved/recusado/completed`.

### Dados Pessoais (LGPD)
Fotos e descrições podem conter dados do imóvel/inquilino; retenção pela vigência do contrato + histórico do imóvel. Prestadores: dado de contato profissional.

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Chamados abertos por imóvel | 120s | `maint:open:{tenantId}:{propertyId}` | status change |

### Métricas
- `open_maintenance`: chamados abertos por tenant.
- `avg_resolution_time`: tempo médio abertura→conclusão.
- `approval_sla_breach`: aprovações fora do SLA.

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Limite de alçada default (valor) | Fluxo de aprovação | PM | Fase 2 |
| 2 | Pagamento ao prestador dentro da plataforma? | Escopo financeiro | PM | Fase 3 |
