# PRD Detalhado — Portais Externos (Proprietário, Cliente, Corretor)

**Módulo:** MOD-PORTAL
**Arquivo:** 14/20
**Prioridade:** P1
**Fase de Implementação:** 2 (Operação)
**Serviço Backend:** portal-service / BFF (`backend/src/modules/portal`, monólito porta 3001)
**Tabelas Principais:** portal_sessions, portal_favorites, portal_proposals, portal_access_grants (a maior parte agrega dados de outros módulos)
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** Os três portais reduzem a carga operacional da equipe dando autoatendimento aos atores externos: o **proprietário** vê repasses/vistorias/contratos sem ligar; o **cliente/inquilino** busca imóveis, favorita, propõe e acompanha pagamentos; o **corretor** vê leads, agenda e comissões no celular. É uma camada **BFF de agregação** — pouca lógica própria, muita composição segura de dados dos módulos de domínio, sempre restrita ao escopo do ator.

**Integração sistêmica.** Compõe dados de MOD-IMOVEL, MOD-OWNER, MOD-CLIENTE, MOD-CONTRATO, MOD-FIN, MOD-RENTAL, MOD-MAINT, MOD-CRM, MOD-AGENDA, MOD-CORRETOR. Autenticação via Clerk (MOD-AUTH) com papéis externos. Publica `proposal.created`, `favorite.added`.

**Escopo desta fase.** MVP: os três portais como áreas do app principal (sub-rotas), com feature gating por papel; leitura agregada + ações essenciais (favoritar, propor, confirmar visita, abrir chamado). **Fora desta fase:** apps nativos separados (mobile é fase posterior), personalização visual do portal por tenant além do branding padrão.

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-PORTAL-01 | Portal do Proprietário | Imóveis, repasses, contratos, vistorias, chamados, documentos | Must Have |
| MOD-PORTAL-02 | Portal do Cliente | Busca, favoritos, propostas, status de contrato/pagamento, chamados | Must Have |
| MOD-PORTAL-03 | Portal do Corretor | Leads atribuídos, agenda, imóveis, comissões, metas | Must Have |
| MOD-PORTAL-04 | Propostas | Cliente envia proposta sobre imóvel | Should Have |
| MOD-PORTAL-05 | Favoritos | Cliente salva imóveis de interesse | Should Have |

## 3. Critérios de Aceite

### [MOD-PORTAL-01] — Portal do Proprietário

**AC-01 (Happy Path)** — **Dado** um proprietário autenticado, **Quando** acessa `/v1/portal/owner/dashboard`, **Então** vê **apenas** seus imóveis, repasses e contratos (HTTP 200).
**AC-02 (Escopo)** — **Dado** o proprietário P1, **Quando** tenta `GET /v1/portal/owner/transfers?ownerId=P2`, **Então** `403`/`404` `ERR_PORTAL_003` (nunca vê dados de outro proprietário — RLS + escopo de sessão).
**AC-03 (Edge Case)** — **Dado** proprietário sem imóveis, **Quando** acessa o dashboard, **Então** `200` com estado vazio orientando o cadastro (não erro).

### [MOD-PORTAL-03] — Portal do Corretor

**AC-01 (Happy Path)** — **Dado** um corretor, **Quando** acessa seu dashboard, **Então** vê leads atribuídos, agenda do dia e comissões próprias.
**AC-02 (Escopo)** — **Dado** corretor A, **Quando** consulta lead atribuído ao corretor B, **Então** `404` (só vê os próprios).

## 4. Modelo de Dados

> O portal é majoritariamente **agregador**; tabelas próprias mínimas:

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| portal_favorites | tenant_id, customer_id, property_id, created_at | — | ✓ | Favoritos do cliente |
| portal_proposals | tenant_id, id, customer_id, property_id, amount, status, message | — | ✓ | Proposta |
| portal_access_grants | tenant_id, subject_type, subject_id, scope | — | ✓ | Escopo de acesso do ator externo |

### Índices
```sql
CREATE INDEX idx_favorites_customer ON portal_favorites(tenant_id, customer_id);
CREATE INDEX idx_proposals_tenant_status ON portal_proposals(tenant_id, status);
CREATE INDEX idx_grants_subject ON portal_access_grants(tenant_id, subject_type, subject_id);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/portal/owner/dashboard | Portal(Proprietário) | Visão consolidada |
| GET | /v1/portal/owner/transfers | Portal(Proprietário) | Repasses próprios |
| GET | /v1/portal/client/properties | Portal(Cliente) | Busca no catálogo |
| POST | /v1/portal/client/favorites | Portal(Cliente) | Favoritar |
| POST | /v1/portal/client/proposals | Portal(Cliente) | Enviar proposta |
| GET | /v1/portal/client/contracts | Portal(Cliente) | Contratos/pagamentos próprios |
| GET | /v1/portal/broker/dashboard | Portal(Corretor)=CORRETOR | Leads/agenda/comissões |

```typescript
export const CreateProposalSchema = z.object({
  propertyId: z.string(),
  amount: z.number().positive(),
  message: z.string().max(1000).optional(),
})
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_PORTAL_001 | 404 | Não encontrado / fora de escopo |
| ERR_PORTAL_002 | 422 | Inválido |
| ERR_PORTAL_003 | 403 | Fora do escopo do ator externo |

## 6. Máquinas de Estado

### Proposta — Status

```
ENVIADA ──(corretor aceita)──► ACEITA ──(vira deal/contrato)──► CONVERTIDA
   │
   ├──(corretor recusa)──► RECUSADA
   └──(cliente retira)──► RETIRADA
```

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| — | ENVIADA | `proposal.created` | corretor/gestor | ✓ |
| ENVIADA | ACEITA | `proposal.accepted` | cliente | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Ator externo só acessa suas próprias entidades | Escopo de sessão + RLS | MOD-AUTH |
| RN-02 | Cliente só vê imóveis DISPONIVEL no catálogo | Filtro de status | MOD-IMOVEL |
| RN-03 | Proposta aceita sugere criar deal/contrato | Não cria automático | MOD-CRM, MOD-CONTRATO |
| RN-04 | Portal é read-mostly; escritas limitadas a ações permitidas | Menor privilégio | Segurança |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `proposal.created` | portal | crm, notification | `{ tenantId, proposalId, customerId, propertyId, amount }` |
| `favorite.added` | portal | ai-orchestrator (perfil) | `{ tenantId, customerId, propertyId }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Proprietário | Cliente | Corretor |
|---|---|---|---|
| Ver dashboard próprio | ✓ | ✓ | ✓ |
| Ver dados de terceiros | — | — | — (só atribuídos) |
| Favoritar/propor | — | ✓ | — |
| Aprovar manutenção | ✓ (próprio imóvel) | — | — |

### Audit Log
`portal.login`, `proposal.created`, acessos a dados sensíveis (repasses/contratos) por ator externo.

### Dados Pessoais (LGPD)
Portal expõe dados pessoais/financeiros ao próprio titular — reforço de escopo é crítico. Todo acesso é auditado.

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Dashboard agregado | 60s | `portal:{tenantId}:{role}:{subjectId}` | eventos das fontes |

### Métricas
- `portal_active_users`: usuários externos ativos por tipo.
- `proposals_submitted`: propostas/semana.
- `self_service_rate`: % de ações resolvidas sem contato humano.

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Portais como sub-rotas do app ou apps federados | Arquitetura frontend | Tech Lead | Fase 2 |
| 2 | Onboarding/convite do ator externo (proprietário/inquilino) | UX, adoção | PM | Fase 2 |
