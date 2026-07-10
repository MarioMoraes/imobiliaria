# PRD Detalhado — Publicação Automática em Portais Imobiliários

**Módulo:** MOD-PUBLISH
**Arquivo:** 15/20
**Prioridade:** P1
**Fase de Implementação:** 3 (Presença Digital)
**Serviço Backend:** publishing-service (`backend/src/modules/publishing`, monólito porta 3001)
**Tabelas Principais:** portal_integrations, publication_listings, publication_sync_logs, feed_snapshots
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** Publicar imóveis em Viva Real, ZAP, OLX, Imovelweb e site próprio é hoje trabalho manual e repetitivo, e o pior erro é **manter anúncio de imóvel já alugado/vendido** — gera lead frustrado e retrabalho. Este módulo automatiza a exportação (feed XML/API) e, sobretudo, a **sincronização de status**: ao alugar/vender, o imóvel sai dos portais automaticamente.

**Integração sistêmica.** Consome MOD-IMOVEL (fonte dos anúncios); reage a `property.created/updated/status_changed`. Descrições de anúncio vêm do MOD-AI (geração). Publica `publication.synced`, `publication.failed`.

**Escopo desta fase.** MVP: configuração de integração por portal e por tenant, geração de feed padrão (Viva Real/ZAP usam padrão XML tipo "VivaReal"/"ZAP"), sincronização de status (pausar/remover ao mudar status), logs de sincronização e retry. **Fora desta fase:** sincronização bidirecional (importar leads dos portais é do MOD-CRM via integração), publicação em redes sociais (fica no MOD-AI/marketing).

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-PUBLISH-01 | Configuração de portais | Credenciais/opções por portal por tenant | Must Have |
| MOD-PUBLISH-02 | Geração de feed | Feed XML/API no formato de cada portal | Must Have |
| MOD-PUBLISH-03 | Sincronização de status | Pausar/remover ao alugar/vender/inativar | Must Have |
| MOD-PUBLISH-04 | Logs e retry | Registro de sync + reprocessamento em falha | Must Have |
| MOD-PUBLISH-05 | Seleção de imóveis publicáveis | Regras de quais imóveis vão a cada portal | Should Have |

## 3. Critérios de Aceite

### [MOD-PUBLISH-03] — Sincronização de status

**AC-01 (Happy Path)** — **Dado** um imóvel publicado no Viva Real, **Quando** `property.status_changed` para `ALUGADO`, **Então** o listing é removido/pausado no portal, `publication.synced` é publicado, log registrado.
**AC-02 (Falha do portal)** — **Dado** o portal indisponível, **Quando** a sync falha, **Então** entra em DLX com backoff (1s,5s,30s,5min), marca `FALHA_TEMPORARIA`, alerta após esgotar retries.
**AC-03 (Edge Case — dessincronização)** — **Dado** um imóvel marcado ALUGADO mas ainda visível no portal após retries, **Quando** o job de auditoria de consistência roda, **Então** força nova remoção e alerta o gestor.

### [MOD-PUBLISH-02] — Geração de feed

**AC-01 (Happy Path)** — **Dado** imóveis marcados como publicáveis, **Quando** o feed é gerado, **Então** produz XML válido no schema do portal, com fotos, descrição (MOD-AI) e preço atuais.
**AC-02 (Validação)** — **Dado** um imóvel sem fotos ou campos obrigatórios do portal, **Quando** gera o feed, **Então** o imóvel é **excluído** do feed com aviso (não invalida o feed inteiro).

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| portal_integrations | tenant_id, id | String | ✓ | Isolamento / PK |
| portal_integrations | portal | Enum | ✓ | VIVAREAL, ZAP, OLX, IMOVELWEB, SITE_PROPRIO |
| portal_integrations | credentials_json (criptografado) | JSONB | ✓ | Credenciais/URL do feed |
| portal_integrations | active | Boolean | ✓ | Ativa |
| publication_listings | tenant_id, property_id, portal, external_id, status, last_synced_at | — | ✓ | Estado por portal |
| publication_sync_logs | tenant_id, listing_id, action, result, error, created_at | — | ✓ | Histórico |
| feed_snapshots | tenant_id, portal, url, generated_at | — | — | Último feed gerado |

### Campos com Criptografia AES-256-GCM
| Campo | Tabela | Justificativa |
|---|---|---|
| credentials_json | portal_integrations | Segredos de terceiros |

### Índices
```sql
CREATE INDEX idx_pub_integr_tenant ON portal_integrations(tenant_id, portal);
CREATE UNIQUE INDEX idx_listing_prop_portal ON publication_listings(property_id, portal);
CREATE INDEX idx_pub_logs_tenant ON publication_sync_logs(tenant_id, created_at DESC);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET/POST | /v1/portal-integrations | ADMIN, GESTOR | Configurar portais |
| POST | /v1/properties/:id/publish | ADMIN, GESTOR, CORRETOR | Publicar em portais |
| POST | /v1/properties/:id/unpublish | idem | Remover |
| GET | /v1/publications | ADMIN, GESTOR | Estado por imóvel/portal |
| GET | /v1/feeds/:portal.xml | público (token) | Feed consumido pelo portal |
| GET | /v1/publications/logs | ADMIN, GESTOR | Logs de sync |

```typescript
export const PortalIntegrationSchema = z.object({
  portal: z.enum(['VIVAREAL','ZAP','OLX','IMOVELWEB','SITE_PROPRIO']),
  credentials: z.record(z.string()),
  active: z.boolean().default(true),
})
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_PUBLISH_001 | 404 | Não encontrado |
| ERR_PUBLISH_002 | 422 | Inválido / imóvel incompleto p/ portal |
| ERR_PUBLISH_003 | 403 | Papel insuficiente |
| ERR_PUBLISH_004 | 502 | Falha na integração do portal |

## 6. Máquinas de Estado

### Listing (por portal) — Status

```
NAO_PUBLICADO ──(publish)──► PUBLICANDO ──(ok)──► PUBLICADO
                                 │                    │
                                 └─(falha)─► FALHA_TEMPORARIA (retry/DLX)
PUBLICADO ──(status imóvel muda)──► REMOVENDO ──(ok)──► REMOVIDO
```

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| NAO_PUBLICADO | PUBLICADO | `publication.synced` | — | ✓ |
| PUBLICADO | REMOVIDO | `publication.synced` | — | ✓ |
| * | FALHA_TEMPORARIA | `publication.failed` | gestor (após retries) | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Imóvel ALUGADO/VENDIDO sai dos portais automaticamente | Reage a `property.status_changed` | MOD-IMOVEL |
| RN-02 | Falha de portal usa DLX com backoff | Idempotência por `external_id` | — |
| RN-03 | Imóvel incompleto é excluído do feed, não quebra feed | Validação por item | — |
| RN-04 | Auditoria de consistência força re-sync | Job periódico | MOD-CRON |
| RN-05 | Descrição de anúncio gerada por IA | Gatilho no MOD-IMOVEL | MOD-AI |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `publication.synced` | publishing | admin | `{ tenantId, propertyId, portal, action }` |
| `publication.failed` | publishing | notification, admin | `{ tenantId, propertyId, portal, error }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Corretor |
|---|---|---|---|---|
| Configurar portais | ✓ | ✓ | — | — |
| Publicar/remover | ✓ | ✓ | ✓ | ✓ |
| Ver logs | ✓ | ✓ | ✓ | — |

### Audit Log
`integration.configured`, `publication.synced/failed`.

### Dados Pessoais (LGPD)
Anúncios expõem dados do **imóvel** (público por natureza); credenciais de portais são segredos cifrados. Sem dado pessoal de cliente no feed.

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Feed gerado | 300s | `feed:{tenantId}:{portal}` | property.updated/status_changed |

### Métricas
- `listings_published`: anúncios ativos por portal.
- `sync_failure_rate`: % falhas de sincronização.
- `stale_listings`: anúncios dessincronizados detectados (alerta).

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Quais portais no MVP (Viva Real/ZAP primeiro?) | Escopo integração | PM | Fase 3 |
| 2 | Importação de leads dos portais (bidirecional) | CRM | PM | Fase 3+ |
| 3 | Custo por anúncio/portal impacta plano? | Billing | PM | Fase 3 |
