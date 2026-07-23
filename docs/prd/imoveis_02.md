# PRD Detalhado — Cadastro e Gestão de Imóveis

**Módulo:** MOD-IMOVEL
**Arquivo:** 02/20
**Prioridade:** P0
**Fase de Implementação:** 1 (Core de Gestão)
**Serviço Backend:** property-service (`backend/src/modules/property`, monólito porta 3001)
**Tabelas Principais:** properties, property_media, property_price_history, property_status_history, property_owners, property_features
**Data:** 2026-07-10
**Status:** Draft

> O módulo `property` já existe no repositório como referência de padrão (`schema/repository/service/routes.ts` + teste de isolamento). Este PRD detalha a evolução para o escopo completo do PRD 7.1.

---

## 1. Visão Geral

**Contexto de negócio.** O imóvel é o produto central da imobiliária. Este módulo é a **fonte única de verdade** do inventário: sem dados de imóvel estruturados, completos e atualizados, nenhum agente de IA recomenda corretamente, nenhum portal publica corretamente e nenhum contrato se vincula corretamente. A qualidade do cadastro impacta diretamente a taxa de conversão de leads.

**Integração sistêmica.** Downstream: `publishing-service` (MOD-PUBLISH) exporta imóveis para portais; `ai-orchestrator-service` (MOD-AI) usa para recomendação e geração de anúncios; `contract-service` (MOD-CONTRATO) vincula imóvel a contrato; `portal-service` (MOD-PORTAL) expõe catálogo. Upstream: depende de `owner-service` (proprietário vinculado) e MOD-AUTH (tenant/RBAC). Publica `property.created`, `property.updated`, `property.status_changed`.

**Escopo desta fase.** MVP: cadastro por todos os tipos (venda, locação, temporada, comercial, rural, terreno, empreendimento com unidades), campos completos, mídia (fotos/vídeos/tour 360°/planta), histórico de preço e status, busca/filtros avançados, geocodificação de endereço. Geração de descrição por IA é **integração** com MOD-AI (o gatilho fica aqui; o texto vem de lá). **Fora desta fase:** sincronização bidirecional com portais (só exportação — fica no MOD-PUBLISH), matrícula/RGI validado em cartório.

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-IMOVEL-01 | CRUD de imóvel | Cadastro completo por finalidade, com validação por finalidade | Must Have |
| MOD-IMOVEL-10 | Tipo de imóvel (lookup) | Catálogo editável por tenant (Apartamento, Casa, Sala, Terreno…), **distinto da finalidade** venda/locação | Must Have |
| MOD-IMOVEL-02 | Gestão de mídia | Upload/ordenação de fotos, vídeos, tour 360°, planta | Must Have |
| MOD-IMOVEL-03 | Histórico de preço | Registro imutável de cada alteração de valor | Must Have |
| MOD-IMOVEL-04 | Histórico/máquina de status | Disponível → Reservado → Alugado/Vendido → Inativo | Must Have |
| MOD-IMOVEL-05 | Vínculo com proprietário(s) | N:N imóvel↔proprietário com % de participação | Must Have |
| MOD-IMOVEL-06 | Busca e filtros avançados | Filtro por tipo, faixa de preço, características, geo (raio) | Must Have |
| MOD-IMOVEL-07 | Empreendimento + unidades | Imóvel-pai com unidades filhas vinculadas | Should Have |
| MOD-IMOVEL-08 | Geração de anúncio por IA | Dispara MOD-AI para gerar descrição | Should Have |
| MOD-IMOVEL-09 | Geocodificação | Endereço → lat/long para busca por raio | Should Have |

## 3. Critérios de Aceite

### [MOD-IMOVEL-01] — CRUD de imóvel

**AC-01 (Happy Path)** — **Dado** um GESTOR autenticado, **Quando** faz `POST /v1/properties` com tipo `LOCACAO`, endereço, valor de aluguel e ≥1 proprietário, **Então** o imóvel é criado com `status=DISPONIVEL`, evento `property.created` é publicado (HTTP 201).
**AC-02 (Validação)** — **Dado** um imóvel tipo `LOCACAO` **sem** `rental_value`, **Quando** submete, **Então** `422` `ERR_IMOVEL_002` "Valor de locação obrigatório para tipo LOCACAO".
**AC-03 (Edge Case — isolamento)** — **Dado** um imóvel de `T2`, **Quando** um usuário de `T1` faz `GET /v1/properties/:id`, **Então** `404` `ERR_IMOVEL_001` (RLS impede vazamento; nunca `403` que revelaria existência).

### [MOD-IMOVEL-04] — Máquina de status

**AC-01 (Happy Path)** — **Dado** um imóvel `DISPONIVEL`, **Quando** `contract.signed` referencia esse imóvel, **Então** transiciona para `ALUGADO`/`VENDIDO`, registra em `property_status_history` e publica `property.status_changed`.
**AC-02 (Transição inválida)** — **Dado** um imóvel `VENDIDO`, **Quando** tenta-se marcar `RESERVADO`, **Então** `409` `ERR_IMOVEL_004` "Transição de status inválida".
**AC-03 (Edge Case — concorrência)** — **Dado** dois corretores reservando o mesmo imóvel simultaneamente, **Quando** ambos enviam `PATCH .../reserve`, **Então** apenas o primeiro sucede (lock otimista por `version`); o segundo recebe `409`.

### [MOD-IMOVEL-06] — Busca e filtros

**AC-01 (Happy Path)** — **Dado** 200 imóveis, **Quando** `GET /v1/properties?type=LOCACAO&minPrice=1000&maxPrice=3000&bedrooms=2&lat=-23.5&lng=-46.6&radiusKm=5`, **Então** retorna paginado só imóveis do tenant que casam TODOS os filtros (HTTP 200).
**AC-02 (Validação)** — **Dado** `radiusKm=5` sem `lat/lng`, **Quando** consulta, **Então** `422` `ERR_IMOVEL_002`.
**AC-03 (Edge Case)** — **Dado** filtro sem resultado, **Quando** consulta, **Então** `200` com `{ data: [], total: 0 }` (não erro).

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| properties | tenant_id | String | ✓ | Isolamento |
| properties | id | String | ✓ | PK |
| properties | code | String | ✓ | Código interno legível (ex.: `AP-0042`), único por tenant |
| properties | purpose | Enum | ✓ | **Finalidade** do negócio: VENDA, LOCACAO, TEMPORADA (um imóvel pode ter mais de uma — ver `property_purposes`) |
| properties | property_type_id | String | ✓ | **Tipo do imóvel** (FK → `property_types`): Apartamento, Casa, Sala, Terreno, Galpão, Rural… (lookup editável por tenant) |
| properties | is_development | Boolean | ✓ | Se é um empreendimento-pai (unidades via `parent_id`) |
| properties | parent_id | String | — | FK para empreendimento-pai (unidade) |
| properties | status | Enum | ✓ | DISPONIVEL, RESERVADO, ALUGADO, VENDIDO, INATIVO |
| properties | address_json | JSONB | ✓ | Logradouro, número, bairro, cidade, UF, CEP |
| properties | lat, lng | Decimal | — | Geocodificação |
| properties | sale_value | Decimal | — | Valor de venda (obrigatório se VENDA) |
| properties | rental_value | Decimal | — | Aluguel (obrigatório se LOCACAO) |
| properties | condo_fee, iptu | Decimal | — | Condomínio / IPTU |
| properties | area_total, area_util | Decimal | — | Áreas em m² |
| properties | bedrooms, suites, bathrooms, parking | Int | — | Características numéricas |
| properties | version | Int | ✓ | Lock otimista |
| property_features | property_id, feature | — | ✓ | Piscina, mobiliado, pet-friendly etc. |
| property_media | property_id, url, kind, position | — | ✓ | kind: PHOTO/VIDEO/TOUR360/FLOORPLAN |
| property_price_history | property_id, field, old_value, new_value, changed_by, changed_at | — | ✓ | Imutável |
| property_status_history | property_id, from_status, to_status, reason, changed_at | — | ✓ | Imutável |
| property_owners | property_id, owner_id, share_pct | — | ✓ | N:N com % de participação |
| property_types | tenant_id, id, name, active | — | ✓ | **Lookup editável por tenant** (Apartamento, Casa, Sala, Terreno, Galpão, Rural…). Espelha a tela legada "Tipo de Imóvel" |
| property_purposes | property_id, purpose | — | — | Permite imóvel com múltiplas finalidades (ex.: venda **e** locação) |

> **Modelagem — finalidade × tipo (compat. sistema legado):** o cadastro legado separa a **finalidade** (venda/locação) do **tipo do imóvel** (apartamento, casa, sala, terreno…). Por isso `purpose` (enum fixo) é distinto de `property_type_id` (lookup editável por tenant). COMERCIAL/RURAL/TERRENO deixam de ser "tipo de negócio" e passam a ser **tipos de imóvel** no lookup. EMPREENDIMENTO vira a flag `is_development` + `parent_id`.

### Campos com Criptografia AES-256-GCM

| Campo | Tabela | Justificativa |
|---|---|---|
| — | — | Imóvel em si não tem dado sensível; dados bancários do proprietário ficam em `owner-service` (MOD-OWNER) |

### Índices Necessários

```sql
CREATE INDEX idx_properties_tenant ON properties(tenant_id);
CREATE INDEX idx_properties_tenant_status ON properties(tenant_id, status);
CREATE INDEX idx_properties_tenant_type_status ON properties(tenant_id, type, status);
CREATE UNIQUE INDEX idx_properties_tenant_code ON properties(tenant_id, code);
CREATE INDEX idx_properties_geo ON properties USING gist (ll_to_earth(lat, lng)); -- busca por raio
```

## 5. Contratos de API

### Endpoints

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/properties | todos internos + portal | Listar (paginado, filtros, geo) |
| POST | /v1/properties | ADMIN, GESTOR, CORRETOR | Criar |
| GET | /v1/properties/:id | todos internos + portal | Buscar por ID |
| PATCH | /v1/properties/:id | ADMIN, GESTOR, CORRETOR (próprios) | Atualizar |
| POST | /v1/properties/:id/reserve | GESTOR, CORRETOR | Reservar |
| POST | /v1/properties/:id/media | ADMIN, GESTOR, CORRETOR | Anexar mídia |
| POST | /v1/properties/:id/generate-description | GESTOR, CORRETOR | Dispara MOD-AI |
| DELETE | /v1/properties/:id | ADMIN, GESTOR | Inativar (soft) |

### Schema Zod — `@offices-ai/shared`

```typescript
export const CreatePropertySchema = z.object({
  type: z.enum(['VENDA','LOCACAO','TEMPORADA','COMERCIAL','RURAL','TERRENO','EMPREENDIMENTO']),
  address: z.object({
    street: z.string(), number: z.string(), district: z.string(),
    city: z.string(), state: z.string().length(2), zip: z.string().regex(/^\d{8}$/),
  }),
  saleValue: z.number().positive().optional(),
  rentalValue: z.number().positive().optional(),
  condoFee: z.number().nonnegative().optional(),
  iptu: z.number().nonnegative().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  ownerIds: z.array(z.object({ ownerId: z.string(), sharePct: z.number().min(0).max(100) })).min(1),
}).refine(d => d.type !== 'VENDA' || d.saleValue != null, { message: 'saleValue obrigatório p/ VENDA' })
  .refine(d => d.type !== 'LOCACAO' || d.rentalValue != null, { message: 'rentalValue obrigatório p/ LOCACAO' })
export type CreatePropertyInput = z.infer<typeof CreatePropertySchema>
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_IMOVEL_001 | 404 | Imóvel não encontrado no tenant |
| ERR_IMOVEL_002 | 422 | Dados inválidos |
| ERR_IMOVEL_003 | 403 | Papel insuficiente |
| ERR_IMOVEL_004 | 409 | Transição de status/reserva inválida |

## 6. Máquinas de Estado

### Imóvel — Status

```
DISPONIVEL
   │
   ├─(reserve, se DISPONIVEL)──► RESERVADO
   │                              │
   │                              ├─(contract.signed)──► ALUGADO / VENDIDO
   │                              └─(cancel_reserve, timeout 48h)──► DISPONIVEL
   │
   ├─(contract.signed direto)──► ALUGADO / VENDIDO
   │                              │
   │                              └─(contract.ended / distrato)──► DISPONIVEL
   │
   └─(inativar)──► INATIVO ──(reativar)──► DISPONIVEL
```

**Efeitos colaterais:**

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| DISPONIVEL | RESERVADO | `property.status_changed` | corretor + proprietário (portal) | ✓ |
| RESERVADO/DISPONIVEL | ALUGADO/VENDIDO | `property.status_changed` | publishing (remover do feed), proprietário | ✓ |
| * | INATIVO | `property.status_changed` | publishing (remover) | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Soma de `share_pct` dos proprietários ≠ 100% | `422` na criação/edição | MOD-OWNER |
| RN-02 | Imóvel ALUGADO/VENDIDO sai automaticamente dos portais | Publica evento p/ MOD-PUBLISH remover feed | MOD-PUBLISH |
| RN-03 | Reserva expira em 48h sem contrato | Job cron volta a DISPONIVEL | MOD-CRON |
| RN-04 | Alteração de `rental_value`/`sale_value` sempre versiona | Grava em `property_price_history` | MOD-AI (recomenda), MOD-PUBLISH |
| RN-05 | Unidade não pode ter status "vendido" com pai INATIVO | Valida hierarquia | — |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `property.created` | property | publishing, ai-orchestrator, portal | `{ tenantId, propertyId, type, timestamp }` |
| `property.updated` | property | publishing, ai-orchestrator, portal | `{ tenantId, propertyId, changedFields, timestamp }` |
| `property.status_changed` | property | publishing, portal, notification | `{ tenantId, propertyId, from, to, timestamp }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Corretor | Financeiro | Portal (Cliente) |
|---|---|---|---|---|---|---|
| Listar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (só DISPONIVEL) |
| Criar | ✓ | ✓ | ✓ | ✓ | — | — |
| Editar | ✓ | ✓ | ✓ | ✓ (próprios) | — | — |
| Deletar | ✓ | ✓ | ✓ | — | — | — |

### Audit Log
`property.created`, `property.price_changed`, `property.status_changed`, `property.deleted` → `action, entity, entityId, userId, tenantId, payload, ipAddress`.

### Dados Pessoais (LGPD)
Imóvel não contém dado pessoal direto; o vínculo com proprietário referencia `owner_id` (dados sensíveis ficam no MOD-OWNER). Endereço do imóvel = dado do bem, não pessoal.

## 10. Performance & Observabilidade

### Cache Redis

| Dado | TTL | Chave | Invalida quando |
|---|---|---|---|
| Catálogo de disponíveis | 120s | `props:avail:{tenantId}:{filtroHash}` | `property.status_changed`, `property.created` |
| Imóvel individual | 300s | `prop:{tenantId}:{id}` | `property.updated` |

### Métricas

- `properties_active`: imóveis DISPONIVEL por tenant (diário).
- `property_avg_time_to_deal`: dias entre criação e mudança para ALUGADO/VENDIDO.
- `media_per_property`: média de mídias por imóvel (indicador de qualidade de cadastro).

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Provedor de geocodificação (Google vs Nominatim) | Custo, geo-busca | Tech Lead | Fase 1 |
| 2 | Armazenamento de mídia (bucket S3-compat AtlasCloud?) | Infra, custo | Tech Lead | Fase 1 |
| 3 | Timeout de reserva configurável por tenant? | RN-03 | PM | Fase 2 |
