# PRD Detalhado — Gestão de Corretores

**Módulo:** MOD-CORRETOR
**Arquivo:** 05/20
**Prioridade:** P1
**Fase de Implementação:** 1 (Core de Gestão)
**Serviço Backend:** broker-service (`backend/src/modules/broker`, monólito porta 3001)
**Tabelas Principais:** brokers, broker_teams, commission_rules, broker_goals, broker_assignments
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** O corretor é quem fecha negócio. A imobiliária precisa organizar corretores em equipes/hierarquia, definir regras de comissionamento e metas, e distribuir leads/imóveis de forma justa. A **regra de comissão** impacta diretamente o cálculo financeiro (MOD-FIN) e a motivação da equipe.

**Integração sistêmica.** Consome MOD-AUTH (todo corretor é um `user` com papel `CORRETOR`). Alimenta `crm-service` (atribuição de leads — **round-robin automático**, conforme decisão de negócio), `financial-service` (comissões), `scheduling-service` (agenda). Consumido pelo Portal do Corretor (MOD-PORTAL). Publica `broker.created`, `commission_rule.updated`.

**Escopo desta fase.** MVP: cadastro, hierarquia (equipe/gerente), regras de comissão (% por tipo de negócio), metas, vínculo de leads/imóveis captados, ranking de performance. **Fora desta fase:** cálculo de split multi-nível (override de gerente sobre comissão do corretor) — só comissão direta no MVP.

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-CORRETOR-01 | CRUD corretor | Cadastro vinculado a `user`, CRECI, contato | Must Have |
| MOD-CORRETOR-02 | Equipes e hierarquia | Equipes com gerente responsável | Must Have |
| MOD-CORRETOR-03 | Regras de comissão | % por tipo (venda/locação), por corretor/equipe | Must Have |
| MOD-CORRETOR-04 | Metas | Meta mensal (valor/qtde) por corretor/equipe | Should Have |
| MOD-CORRETOR-05 | Distribuição round-robin | Fila de rodízio p/ atribuição automática de leads | Must Have |
| MOD-CORRETOR-06 | Ranking/performance | Leads, visitas, contratos, comissão acumulada | Should Have |

## 3. Critérios de Aceite

### [MOD-CORRETOR-05] — Distribuição round-robin

**AC-01 (Happy Path)** — **Dado** 3 corretores ativos [A,B,C] e último lead ao A, **Quando** chega novo lead sem regra específica, **Então** é atribuído a **B** (próximo do rodízio), publica atualização ao CRM.
**AC-02 (Validação)** — **Dado** nenhum corretor ativo/disponível, **Quando** chega lead, **Então** cai na **fila não-atribuída** e alerta o gestor (`ERR` não aplicável; comportamento defensivo).
**AC-03 (Edge Case — corretor indisponível)** — **Dado** que o próximo do rodízio (B) está `INDISPONIVEL` (férias/desativado), **Quando** distribui, **Então** **pula** para C e mantém a ordem do rodízio.

### [MOD-CORRETOR-03] — Regras de comissão

**AC-01 (Happy Path)** — **Dado** regra de 5% para venda do corretor A, **Quando** um `contract.signed` de venda referencia A, **Então** MOD-FIN calcula comissão = 5% × valor, gera lançamento (evento `commission.due`).
**AC-02 (Validação)** — **Dado** `pct > 100` ou negativo, **Quando** cria regra, **Então** `422` `ERR_CORRETOR_002`.
**AC-03 (Edge Case)** — **Dado** duas regras conflitantes (corretor + equipe), **Quando** calcula, **Então** a regra **mais específica** (corretor) prevalece.

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| brokers | tenant_id, id | String | ✓ | Isolamento / PK |
| brokers | user_id | String | ✓ | FK users (papel CORRETOR) |
| brokers | creci | String | ✓ | Registro CRECI |
| brokers | cpf, rg (cript.) | String | — | Documentos (campos do legado) |
| brokers | phone, mobile (cript.) | String | — | Telefone e Celular diretos do corretor |
| brokers | street, district, city, state, zip | String | — | Endereço do corretor (campos do legado) |
| brokers | default_commission_pct | Decimal | — | Comissão padrão (%), usada se não houver `commission_rules` |
| brokers | team_id | String | — | FK equipe |
| brokers | availability | Enum | ✓ | DISPONIVEL, INDISPONIVEL |
| broker_teams | id, tenant_id, name, manager_id | — | ✓ | Equipe + gerente |
| commission_rules | tenant_id, scope, scope_id, deal_type, pct | — | ✓ | scope: BROKER/TEAM; deal_type: VENDA/LOCACAO |
| broker_goals | broker_id, period, target_value, target_count | — | — | Metas |
| broker_assignments | broker_id, entity_type, entity_id, assigned_at | — | ✓ | Leads/imóveis atribuídos |

### Índices

```sql
CREATE INDEX idx_brokers_tenant ON brokers(tenant_id);
CREATE UNIQUE INDEX idx_brokers_user ON brokers(user_id);
CREATE INDEX idx_commission_scope ON commission_rules(tenant_id, scope, scope_id, deal_type);
CREATE INDEX idx_assignments_broker ON broker_assignments(broker_id, assigned_at DESC);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/brokers | ADMIN, GESTOR | Listar |
| POST | /v1/brokers | ADMIN, GESTOR | Criar |
| GET | /v1/brokers/:id | ADMIN, GESTOR, CORRETOR(próprio) | Detalhe + performance |
| PATCH | /v1/brokers/:id | ADMIN, GESTOR | Atualizar |
| POST | /v1/commission-rules | ADMIN, GESTOR | Criar regra |
| GET | /v1/brokers/:id/goals | ADMIN, GESTOR, CORRETOR(próprio) | Metas |
| GET | /v1/brokers/ranking | ADMIN, GESTOR | Ranking |

```typescript
export const CreateCommissionRuleSchema = z.object({
  scope: z.enum(['BROKER','TEAM']),
  scopeId: z.string(),
  dealType: z.enum(['VENDA','LOCACAO']),
  pct: z.number().min(0).max(100),
})
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_CORRETOR_001 | 404 | Não encontrado |
| ERR_CORRETOR_002 | 422 | Inválido (pct fora do range) |
| ERR_CORRETOR_003 | 403 | Papel insuficiente |
| ERR_CORRETOR_004 | 409 | CRECI duplicado |

## 6. Máquinas de Estado

### Corretor — Disponibilidade

```
DISPONIVEL ──(férias/afastamento)──► INDISPONIVEL ──(retorno)──► DISPONIVEL
     │
     └──(desligamento → user DISABLED)──► INATIVO
```

| De | Para | Evento | Efeito |
|---|---|---|---|
| DISPONIVEL | INDISPONIVEL | `broker.availability_changed` | sai da fila round-robin (CRM) |
| * | INATIVO | `broker.deactivated` | reatribui leads abertos ao gestor |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Round-robin ignora corretor INDISPONIVEL | Pula mantendo ordem | MOD-CRM |
| RN-02 | Regra específica (corretor) > regra de equipe | Resolução por especificidade | MOD-FIN |
| RN-03 | Desligamento reatribui leads abertos | Evento p/ gestor redistribuir | MOD-CRM |
| RN-04 | Comissão congela snapshot da regra no fechamento | `contract.signed` guarda pct vigente | MOD-FIN |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `broker.created` | broker | crm | `{ tenantId, brokerId, timestamp }` |
| `broker.availability_changed` | broker | crm | `{ tenantId, brokerId, availability }` |
| `commission_rule.updated` | broker | financial | `{ tenantId, ruleId, timestamp }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Corretor | Financeiro |
|---|---|---|---|---|---|
| Listar | ✓ | ✓ | ✓ | próprio | ✓ (comissão) |
| Criar | ✓ | ✓ | ✓ | — | — |
| Editar regra comissão | ✓ | ✓ | ✓ | — | — |
| Deletar | ✓ | ✓ | — | — | — |

### Audit Log
`broker.created`, `commission_rule.updated`, `broker.deactivated`, `assignment.changed`.

### Dados Pessoais (LGPD)
CRECI e contato do corretor = dado profissional; base legal execução de contrato de trabalho/parceria. Retenção 5 anos pós-desligamento.

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Fila round-robin | sem TTL (estado) | `rr:{tenantId}` | atribuição / availability |
| Regra de comissão | 600s | `comm:{tenantId}:{scope}:{id}` | `commission_rule.updated` |

### Métricas
- `broker_conversion_rate`: contratos / leads atribuídos.
- `broker_response_sla`: tempo médio 1ª resposta a lead.

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Split multi-nível (override de gerente) em qual fase? | Comissão | PM/Financeiro | Fase 2 |
| 2 | Round-robin ponderado por carga atual do corretor? | Distribuição justa | PM | Fase 2 |
