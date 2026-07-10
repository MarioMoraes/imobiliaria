# PRD Detalhado — Sistema Super Admin (Plataforma, Observabilidade, LGPD, Jobs)

**Módulo:** MOD-SADMIN
**Arquivo:** 19/20
**Prioridade:** P0
**Fase de Implementação:** 0/2 (Fundação → evolução na operação)
**Serviço Backend:** admin-service (`backend/src/modules/admin`, monólito porta 3001)
**Tabelas Principais:** platform_config, tenant_quotas, feature_flags, service_health, cron_executions, job_logs, global_audit
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** O Super Admin é o painel da equipe Move AI para operar a plataforma inteira: gerir tenants, monitorar saúde e uso, controlar feature flags por plano/tenant, auditar globalmente e executar rotinas LGPD (exportação/anonimização/exclusão). Também concentra o **dashboard de jobs/crons** (execuções agendadas de todo o sistema) e os **health checks**. É a torre de controle — precisa de visão global cruzando tenants (única exceção controlada ao isolamento, sempre auditada).

**Integração sistêmica.** Consome eventos de todos os módulos (uso, falhas, suspensões). Lê feature flags/limites junto com MOD-BILLING. Health check agrega o `/health` de cada dependência (Postgres, Redis, RabbitMQ). As rotinas LGPD tocam todos os módulos que guardam dado pessoal. Publica `tenant.suspended` (ação admin), `lgpd.export_requested`, `lgpd.anonymized`.

**Escopo desta fase.** MVP: gestão de tenants (criar/suspender/reativar), monitoramento de uso/saúde por tenant e consolidado, feature flags, auditoria global, health checks, dashboard de crons, ferramentas LGPD (exportação JSON/CSV, anonimização, exclusão com checklist). **Fora desta fase:** suporte via ticketing integrado, billing analytics avançado (BI dedicado).

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-SADMIN-01 | Gestão de tenants | Criar/suspender/reativar/cancelar tenants | Must Have |
| MOD-SADMIN-02 | Monitoramento uso/saúde | Métricas por tenant + consolidado | Must Have |
| MOD-SADMIN-03 | Feature flags | Flags por tenant/plano | Must Have |
| MOD-SADMIN-04 | Auditoria global | Visão cross-tenant de audit logs | Must Have |
| MOD-SADMIN-05 | Health checks | Agrega `/health` de Postgres/Redis/RabbitMQ (timeout 3s) | Must Have |
| MOD-SADMIN-06 | Dashboard de jobs/crons | Última/próxima execução, duração, taxa de sucesso | Must Have |
| MOD-SADMIN-07 | Ferramentas LGPD | Exportação, anonimização, exclusão completa | Must Have |

## 3. Critérios de Aceite

### [MOD-SADMIN-05] — Health checks

**AC-01 (Happy Path)** — **Dado** o painel Super Admin, **Quando** consulta `GET /v1/admin/health`, **Então** cada dependência (Postgres, Redis, RabbitMQ) é verificada com **timeout 3s** e retorna `{ status, latencyMs }` por serviço (200 se todos ok).
**AC-02 (Degradação)** — **Dado** RabbitMQ indisponível, **Quando** o health roda, **Então** retorna `503` com o componente marcado `DOWN` e dispara alerta.
**AC-03 (Edge Case — timeout)** — **Dado** um componente que não responde em 3s, **Quando** verifica, **Então** marca `TIMEOUT` (não trava o painel).

### [MOD-SADMIN-07] — Ferramentas LGPD

**AC-01 (Exportação)** — **Dado** um pedido LGPD de um titular/tenant, **Quando** SUPER_ADMIN executa exportação, **Então** gera JSON/CSV com **todos** os dados do titular/tenant nas tabelas relevantes, registra `lgpd.export_requested` (auditado).
**AC-02 (Anonimização)** — **Dado** um pedido de esquecimento, **Quando** executa anonimização, **Então** substitui CPF/email por **hashes irreversíveis**, preservando integridade referencial e obrigações fiscais (registros financeiros mantidos anonimizados).
**AC-03 (Exclusão completa)** — **Dado** cancelamento definitivo de tenant, **Quando** executa exclusão, **Então** segue um **checklist de tabelas** (todas as que têm `tenant_id`), confirma cada etapa e produz relatório imutável do que foi apagado.

### [MOD-SADMIN-01] — Gestão de tenants

**AC-01 (Happy Path)** — **Dado** SUPER_ADMIN, **Quando** suspende um tenant, **Então** publica `tenant.suspended`, o tenant é bloqueado (MOD-AUTH), ação auditada.
**AC-02 (Permissão)** — **Dado** um ADMIN de tenant (não super), **Quando** acessa `/v1/admin/*`, **Então** `403` `ERR_SADMIN_003`.

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| platform_config | key, value_json | — | ✓ | Config global (não por tenant) |
| tenant_quotas | tenant_id, metric, limit, used | — | ✓ | Espelho de limites (sync MOD-BILLING) |
| feature_flags | scope, scope_id, flag, enabled | — | ✓ | scope: GLOBAL/PLAN/TENANT |
| service_health | component, status, latency_ms, checked_at | — | ✓ | Snapshot de health |
| cron_executions | job_name, started_at, finished_at, status, duration_ms | — | ✓ | Execuções de jobs |
| job_logs | execution_id, level, message, created_at | — | ✓ | Logs de job |
| global_audit | (view/agg de audit_logs cross-tenant) | — | — | Auditoria global |

### Índices
```sql
CREATE INDEX idx_feature_flags_scope ON feature_flags(scope, scope_id, flag);
CREATE INDEX idx_cron_exec_job ON cron_executions(job_name, started_at DESC);
CREATE INDEX idx_service_health_comp ON service_health(component, checked_at DESC);
```

## 5. Contratos de API

Todas exigem papel **SUPER_ADMIN** (cross-tenant, auditado).

| Método | Path | Descrição |
|---|---|---|
| GET | /v1/admin/tenants | Listar todos os tenants |
| POST | /v1/admin/tenants/:id/suspend | Suspender |
| POST | /v1/admin/tenants/:id/reactivate | Reativar |
| GET | /v1/admin/metrics | Uso consolidado + por tenant |
| GET/PATCH | /v1/admin/feature-flags | Gerir flags |
| GET | /v1/admin/health | Health checks agregados |
| GET | /v1/admin/crons | Dashboard de jobs |
| POST | /v1/admin/lgpd/export | Exportar dados (tenant/titular) |
| POST | /v1/admin/lgpd/anonymize | Anonimizar titular |
| POST | /v1/admin/lgpd/delete-tenant | Exclusão completa (checklist) |
| GET | /v1/admin/audit | Auditoria global |

```typescript
export const LgpdActionSchema = z.object({
  scope: z.enum(['TENANT','SUBJECT']),
  tenantId: z.string(),
  subjectType: z.enum(['CUSTOMER','OWNER','EMPLOYEE']).optional(),
  subjectId: z.string().optional(),
  action: z.enum(['EXPORT','ANONYMIZE','DELETE']),
  confirmationToken: z.string(), // dupla confirmação p/ DELETE
})
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_SADMIN_001 | 404 | Recurso não encontrado |
| ERR_SADMIN_002 | 422 | Inválido |
| ERR_SADMIN_003 | 403 | Não é SUPER_ADMIN |
| ERR_SADMIN_004 | 409 | Ação já em andamento / confirmação inválida |

## 6. Máquinas de Estado

### LGPD Job — Status

```
SOLICITADO ──(validação + confirmação)──► EM_EXECUCAO ──(sucesso)──► CONCLUIDO
    │                                          │
    └──(confirmação inválida)──► CANCELADO     └──(erro)──► FALHA (retry manual)
```

| De | Para | Evento | Efeito | Audit |
|---|---|---|---|---|
| SOLICITADO | EM_EXECUCAO | `lgpd.export_requested`/`lgpd.anonymize_started` | inicia rotina | ✓ |
| EM_EXECUCAO | CONCLUIDO | `lgpd.anonymized`/`lgpd.exported` | relatório imutável | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Acesso cross-tenant só SUPER_ADMIN e sempre auditado | Exceção controlada ao isolamento | MOD-AUTH |
| RN-02 | Health check com timeout 3s por componente | Não trava painel | Observabilidade |
| RN-03 | DELETE de tenant exige dupla confirmação + checklist | Irreversível — proteção | Todos |
| RN-04 | Anonimização preserva integridade fiscal | Mantém registros financeiros anonimizados | MOD-FIN |
| RN-05 | Feature flag mais específica vence (TENANT>PLAN>GLOBAL) | Resolução por especificidade | Todos |
| RN-06 | Job falho alerta Super Admin por e-mail | Retry policy (3x, backoff) | MOD-NOTIF |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `tenant.suspended` | admin | auth, todos | `{ tenantId, reason:'admin', timestamp }` |
| `lgpd.export_requested` | admin | — (auditoria) | `{ tenantId, subjectId?, actor }` |
| `lgpd.anonymized` | admin | — | `{ tenantId, subjectId, timestamp }` |
| `service.health_degraded` | admin | notification | `{ component, status, timestamp }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin Tenant | Demais |
|---|---|---|---|
| Painel admin | ✓ | — | — |
| Suspender tenant | ✓ | — | — |
| Ferramentas LGPD | ✓ | export próprio (Should) | — |
| Auditoria global | ✓ | própria (restrita) | — |

### Audit Log
**Toda** ação de Super Admin é auditada com destaque (acesso cross-tenant, LGPD, suspensão). Registro imutável com `actor`, `ip`, `payload`.

### Dados Pessoais (LGPD)
Este módulo **opera** os direitos LGPD (acesso, portabilidade, esquecimento). Exportação é a base do direito de portabilidade; anonimização, do direito ao esquecimento; ambos com retenção fiscal preservada.

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Health agregado | 15s | `admin:health` | novo check |
| Feature flags | 300s | `flags:{scope}:{id}` | flag change |

### Métricas
- `platform_active_tenants`: tenants ativos.
- `tenants_suspended`: suspensos.
- `cron_success_rate`: sucesso de jobs por nome.
- `lgpd_requests`: pedidos LGPD processados/mês.

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Ferramenta de scheduler de crons (BullMQ/Redis vs pg-cron) | Jobs | Tech Lead | Fase 0 |
| 2 | SLA de resposta a pedido LGPD (dias) | Compliance | PM/Jurídico | Fase 1 |
| 3 | Painel de observabilidade próprio vs Grafana externo | Observabilidade | Tech Lead | Fase 1 |
