# PRD Detalhado — Cadastro de Clientes (Lead → Cliente → Inquilino/Comprador)

**Módulo:** MOD-CLIENTE
**Arquivo:** 04/20
**Prioridade:** P0
**Fase de Implementação:** 1 (Core de Gestão)
**Serviço Backend:** customer-service (`backend/src/modules/customer`, monólito porta 3001)
**Tabelas Principais:** customers, customer_search_profiles, customer_interactions, customer_documents, customer_consents
**Data:** 2026-07-10
**Status:** Em implementação — MOD-CLIENTE-01 (CRUD unificado + soft delete), 02 (perfil de busca), 03 (interações append-only + timeline) e 04 (deduplicação por CPF/telefone/email → 409 com `existingId`) concluídos (2026-07-12). Transição para INQUILINO/COMPRADOR bloqueada manualmente (RN-05). Pendentes: 05 (consentimento LGPD), 06 (documentos), 07 (ficha cadastral de locatário/cônjuge/endereços). Merge-200 do fluxo de IA (AC-01 dedup) é TODO (depende do MOD-AI).

---

## 1. Visão Geral

**Contexto de negócio.** O cliente unifica toda a jornada: **lead → cliente → inquilino/comprador**. O **perfil de busca** (preferências de imóvel) é o insumo direto da recomendação por IA — quanto mais rico, melhor a conversão. Consolidar histórico de interações (humanas e de IA) num único perfil evita retrabalho e melhora o atendimento.

**Integração sistêmica.** Upstream de `crm-service` (o lead vira deal no funil), `ai-orchestrator-service` (recomendação usa `customer_search_profiles`; conversas gravam `customer_interactions`), `contract-service` (cliente é parte). Publica `customer.created`, `customer.profile_updated`, `customer.stage_changed`.

**Escopo desta fase.** MVP: CRUD unificado, perfil de busca estruturado, histórico de interações (append-only), documentos, consentimento LGPD, deduplicação por CPF/telefone/email. **Fora desta fase:** enriquecimento externo (bureau de dados), o "perfil inteligente por IA" (propensão à conversão) fica no MOD-AI (8.8), consumindo os dados daqui.

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-CLIENTE-01 | CRUD cliente unificado | Lead/cliente/inquilino no mesmo registro, com `stage` | Must Have ✅ |
| MOD-CLIENTE-02 | Perfil de busca | Preferências estruturadas (tipo, faixa, região, quartos) | Must Have ✅ |
| MOD-CLIENTE-03 | Histórico de interações | Timeline append-only (humano + IA + canal) | Must Have ✅ |
| MOD-CLIENTE-04 | Deduplicação | Detecta duplicata por CPF/telefone/email na criação | Must Have ✅ |
| MOD-CLIENTE-05 | Consentimento LGPD | Consentimento e canais de contato permitidos | Must Have |
| MOD-CLIENTE-06 | Documentos | Vínculo com MOD-DOC (RG, comprovante de renda) | Should Have |
| MOD-CLIENTE-07 | Ficha cadastral de locatário | Ficha PF/PJ completa (cônjuge, RG, estado civil, endereços, banco) exigida para virar INQUILINO | Must Have |

> **Dois níveis de completude (compat. legado):** o cliente nasce **leve** como lead (só contato + perfil de busca — bom para a IA). Ao fechar locação e virar **INQUILINO**, exige-se a **ficha cadastral completa** (MOD-CLIENTE-07), equivalente à tela "Cadastro de Locatários" do sistema legado. Essa ficha usa a mesma estrutura de [[proprietarios_03]] (`PersonRecord` compartilhado).

## 3. Critérios de Aceite

### [MOD-CLIENTE-01] — CRUD unificado

**AC-01 (Happy Path)** — **Dado** um lead vindo do chat de IA, **Quando** `POST /v1/customers` com telefone e origem `WHATSAPP`, **Então** cria `stage=LEAD`, publica `customer.created` (201).
**AC-02 (Validação)** — **Dado** nenhum meio de contato (sem email/telefone), **Quando** cria, **Então** `422` `ERR_CLIENTE_002` "Ao menos um contato é obrigatório".
**AC-03 (Edge Case — isolamento)** — **Dado** cliente de `T2`, **Quando** `T1` consulta, **Então** `404` `ERR_CLIENTE_001`.

### [MOD-CLIENTE-04] — Deduplicação

**AC-01 (Happy Path)** — **Dado** um cliente existente com telefone `X`, **Quando** o agente de IA cria lead com o mesmo telefone, **Então** o sistema **retorna o cliente existente** (merge de interação, não duplica) e adiciona a nova interação à timeline (200, não 201).
**AC-02 (Validação)** — **Dado** CPF já existente com dados divergentes, **Quando** cria via API interna, **Então** `409` `ERR_CLIENTE_004` com `existingId` para decisão de merge.
**AC-03 (Edge Case — concorrência)** — **Dado** duas conversas simultâneas do mesmo telefone (WhatsApp + Instagram), **Quando** ambas criam, **Então** lock por telefone garante **um único** cliente; ambas as interações anexam ao mesmo perfil.

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| customers | tenant_id, id | String | ✓ | Isolamento / PK |
| customers | full_name | String | ✓ | Nome |
| customers | cpf (criptografado) | String | — | Único por tenant quando presente |
| customers | email, phone (criptografado) | String | — | Ao menos um obrigatório |
| customers | stage | Enum | ✓ | LEAD, CLIENTE, INQUILINO, COMPRADOR, INATIVO |
| customers | source | Enum | ✓ | WHATSAPP, INSTAGRAM, SITE, PORTAL, INDICACAO, MANUAL |
| customers | assigned_broker_id | String | — | Corretor responsável (via CRM) |
| customer_search_profiles | customer_id | String | ✓ | 1:N (pode ter múltiplos perfis) |
| customer_search_profiles | intent | Enum | ✓ | COMPRA, LOCACAO |
| customer_search_profiles | min_price, max_price | Decimal | — | Faixa |
| customer_search_profiles | property_types, districts | String[] | — | Preferências |
| customer_search_profiles | bedrooms_min, parking_min | Int | — | Requisitos |
| customer_interactions | customer_id, channel, actor, summary, payload, created_at | — | ✓ | Append-only |
| customer_consents | customer_id, purpose, granted, channels[] | — | ✓ | LGPD |
| customer_registration | customer_id | String | — | Ficha cadastral (1:1), preenchida ao virar INQUILINO/COMPRADOR |
| customer_registration | person_type | Enum | — | PF, PJ |
| customer_registration | rg, rg_issuer (cript.) | String | — | RG + órgão expedidor |
| customer_registration | gender, birth_date, marital_status, nationality, occupation | — | — | Dados pessoais (Sexo, Dt Nasc, Estado Civil, Nacionalidade, Profissão) |
| customer_registration | mobile, fax (cript.) | String | — | Contatos adicionais |
| customer_registration | dependents, household_size | Int | — | Dependentes / Nº de pessoas |
| customer_registration | bank, agency, account, holder_name (cript.) | String | — | Dados bancários |
| customer_registration | notes, references | Text | — | Observações e Referências |
| customer_spouse | customer_id, name, occupation, birth_date, cpf, rg | — | — | Cônjuge (cript. onde aplicável) |
| customer_addresses | customer_id, kind, street, number, district, city, state, zip | — | — | kind: RESIDENCIAL / COMERCIAL |

### Campos com Criptografia AES-256-GCM

| Campo | Tabela | Justificativa |
|---|---|---|
| cpf, email, phone | customers | Dado pessoal (LGPD) |

### Índices

```sql
CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_customers_tenant_stage ON customers(tenant_id, stage);
CREATE UNIQUE INDEX idx_customers_tenant_cpf ON customers(tenant_id, cpf) WHERE cpf IS NOT NULL;
CREATE INDEX idx_customers_tenant_phone ON customers(tenant_id, phone);
CREATE INDEX idx_search_profiles_customer ON customer_search_profiles(customer_id);
CREATE INDEX idx_interactions_customer_created ON customer_interactions(customer_id, created_at DESC);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/customers | ADMIN, GESTOR, CORRETOR | Listar (filtro por stage/broker) |
| POST | /v1/customers | ADMIN, GESTOR, CORRETOR, AI_AGENT | Criar (com dedup) |
| GET | /v1/customers/:id | ADMIN, GESTOR, CORRETOR(atribuído) | Detalhe + timeline |
| PATCH | /v1/customers/:id | ADMIN, GESTOR, CORRETOR(atribuído) | Atualizar |
| POST | /v1/customers/:id/search-profiles | idem + AI_AGENT | Adicionar perfil de busca |
| POST | /v1/customers/:id/interactions | idem + AI_AGENT | Registrar interação |
| DELETE | /v1/customers/:id | ADMIN, GESTOR | Inativar (soft) |

```typescript
export const CreateCustomerSchema = z.object({
  fullName: z.string().min(2),
  cpf: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  source: z.enum(['WHATSAPP','INSTAGRAM','SITE','PORTAL','INDICACAO','MANUAL']),
  searchProfile: z.object({
    intent: z.enum(['COMPRA','LOCACAO']),
    minPrice: z.number().optional(), maxPrice: z.number().optional(),
    propertyTypes: z.array(z.string()).optional(),
    districts: z.array(z.string()).optional(),
  }).optional(),
}).refine(d => d.email || d.phone, { message: 'email ou telefone obrigatório' })
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_CLIENTE_001 | 404 | Não encontrado |
| ERR_CLIENTE_002 | 422 | Inválido / sem contato |
| ERR_CLIENTE_003 | 403 | Papel insuficiente |
| ERR_CLIENTE_004 | 409 | Duplicata (retorna `existingId`) |

## 6. Máquinas de Estado

### Cliente — Stage

```
LEAD ──(qualificado pelo CRM/IA)──► CLIENTE ──(assina contrato locação)──► INQUILINO
  │                                     │
  │                                     └──(assina contrato compra)──► COMPRADOR
  │
  └──(sem interação 90 dias)──► INATIVO ──(reengaja)──► LEAD
```

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| — | LEAD | `customer.created` | corretor atribuído (CRM) | ✓ |
| LEAD | CLIENTE | `customer.stage_changed` | — | ✓ |
| CLIENTE | INQUILINO/COMPRADOR | `customer.stage_changed` | portal (acesso liberado) | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Dedup por telefone/CPF/email | Merge não-destrutivo; nunca duplica pessoa | MOD-AI, MOD-CRM |
| RN-02 | Interações são imutáveis (append-only) | Nunca editar/apagar; correção = nova interação | MOD-AI |
| RN-03 | Inativação automática por inatividade | Job cron 90 dias sem interação | MOD-CRON |
| RN-04 | AI_AGENT pode criar/ler/atualizar, nunca deletar | RBAC restrito | MOD-AI |
| RN-05 | Cliente vira INQUILINO/COMPRADOR só via `contract.signed` | Não manualmente | MOD-CONTRATO |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `customer.created` | customer | crm, ai-orchestrator | `{ tenantId, customerId, source, timestamp }` |
| `customer.profile_updated` | customer | ai-orchestrator (re-recomenda) | `{ tenantId, customerId, timestamp }` |
| `customer.stage_changed` | customer | crm, portal, notification | `{ tenantId, customerId, from, to, timestamp }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Corretor | Financeiro | AI_AGENT |
|---|---|---|---|---|---|---|
| Listar | ✓ | ✓ | ✓ | atribuídos | — | via tool restrita |
| Criar | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Editar | ✓ | ✓ | ✓ | atribuídos | — | ✓ (perfil/interação) |
| Deletar | ✓ | ✓ | — | — | — | — |

### Audit Log
`customer.created`, `customer.stage_changed`, `customer.merged`, `customer.consent_changed` + toda leitura por AI_AGENT (rastreabilidade de agente — SPEC 9.4).

### Dados Pessoais (LGPD)

| Campo | Categoria | Base Legal | Retenção | Exportável | Deletável |
|---|---|---|---|---|---|
| cpf, email, phone | Dado pessoal | Consentimento / execução | 5 anos pós-relação | ✓ | anonimização |
| interações | Dado pessoal | Legítimo interesse | 24 meses | ✓ | ✓ |
| perfil de busca | Dado pessoal | Consentimento | Enquanto ativo | ✓ | ✓ |

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Perfil de busca | 300s | `cust:profile:{tenantId}:{id}` | `customer.profile_updated` |

### Métricas
- `leads_created`: por origem/dia.
- `lead_to_client_conversion`: % LEAD→CLIENTE por tenant.
- `dedup_merges`: merges por dia (qualidade de dados).

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Regra de merge automático vs sugestão manual | Qualidade de dados | PM | Fase 1 |
| 2 | Janela de inatividade (90d) configurável por tenant? | RN-03 | PM | Fase 2 |
