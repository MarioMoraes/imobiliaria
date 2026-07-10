# PRD Detalhado — Camada de Agentes de IA (AaaS / LangGraph)

**Módulo:** MOD-AI
**Arquivo:** 20/20
**Prioridade:** P0
**Fase de Implementação:** 4 (AaaS)
**Serviço Backend:** ai-orchestrator-service (`backend/src/modules/ai`, monólito porta 3001; workers de IA podem escalar à parte)
**Tabelas Principais:** agent_conversations, agent_messages, agent_context, ai_credits, agent_tool_calls, rag_index_meta
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** Esta é a camada diferencial do produto: agentes de IA (orquestrados via **LangGraph**) que atendem clientes em múltiplos canais (WhatsApp, Instagram, chat, e-mail), qualificam leads, recomendam imóveis, geram anúncios, fazem OCR, atuam como copiloto interno e geram relatórios — sempre consumindo os módulos de domínio como **tools tipadas** (nunca acessando bancos diretamente). O valor está em resolver de ponta a ponta com dados reais e seguros, inclusive fora do horário comercial. O **handoff para humano** dispara por **sentimento negativo OU 3 tentativas sem resolução** (decisão de negócio).

**Integração sistêmica.** Consome como tools: MOD-IMOVEL (recomendação/anúncio), MOD-CLIENTE/MOD-CRM (lead/qualificação/handoff), MOD-AGENDA (agendar visita), MOD-DOC (OCR), MOD-FIN (relatórios). Envio efetivo de mensagens pelo MOD-NOTIF. Uso medido reportado ao MOD-BILLING. Publica `lead.created`, `ai_conversation.handoff_requested`, `ai.usage_metered`, `document.extracted`.

**Escopo desta fase.** MVP (por sub-capacidade da seção 8 do PRD): atendimento multicanal com contexto unificado por pessoa, qualificação de leads, recomendação de imóveis (RAG por tenant), geração de anúncios, OCR/análise documental, assistente interno (copiloto), relatórios em linguagem natural, perfil inteligente do cliente. Sistema de **créditos de IA** com transação atômica. **Fora desta fase:** treino/fine-tuning próprio, voz (áudio bidirecional em tempo real).

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-AI-01 | Atendimento multicanal | Agente unificado com contexto por pessoa entre canais | Must Have |
| MOD-AI-02 | Qualificação de leads | Triagem (orçamento/região/tipo/urgência) → lead no CRM | Must Have |
| MOD-AI-03 | Recomendação (RAG por tenant) | Cruza perfil × inventário via índice vetorial namespaced | Must Have |
| MOD-AI-04 | Geração de anúncios | Texto otimizado a partir dos dados do imóvel | Must Have |
| MOD-AI-05 | OCR/análise documental | Extrai dados de RG/CPF/renda (aciona `document.extracted`) | Should Have |
| MOD-AI-06 | Assistente interno (copiloto) | Busca e ações para a equipe | Should Have |
| MOD-AI-07 | Relatórios inteligentes | Resumos em linguagem natural sobre dados operacionais | Should Have |
| MOD-AI-08 | Perfil inteligente do cliente | Enriquecimento contínuo (propensão, sensibilidade a preço) | Should Have |
| MOD-AI-09 | Handoff para humano | Escala por sentimento OU 3 tentativas sem resolução | Must Have |
| MOD-AI-10 | Créditos de IA | Saldo/reserva/uso com transação atômica | Must Have |

## 3. Critérios de Aceite

### [MOD-AI-01 / MOD-AI-09] — Atendimento + Handoff

**AC-01 (Happy Path)** — **Dado** um cliente no WhatsApp, **Quando** manda mensagem, **Então** o grafo classifica intenção, recupera contexto (RAG), responde com imóveis reais disponíveis e registra a conversa (contexto unificado por telefone/pessoa).
**AC-02 (Handoff automático)** — **Dado** uma conversa com **sentimento negativo detectado** OU **3 tentativas sem resolução** da intenção, **Quando** o nó `check_handoff` avalia, **Então** publica `ai_conversation.handoff_requested` com contexto completo, o corretor assume (CRM/broker) sem perda de informação.
**AC-03 (Edge Case — contexto entre canais)** — **Dado** a mesma pessoa que escreveu no Instagram e depois no WhatsApp, **Quando** a 2ª conversa inicia, **Então** o agente reconhece o mesmo cliente (dedup MOD-CLIENTE) e mantém histórico único.

### [MOD-AI-03] — Recomendação (RAG por tenant)

**AC-01 (Happy Path)** — **Dado** um perfil de busca (locação, 2 quartos, região X, até R$3000), **Quando** o agente recomenda, **Então** consulta o índice vetorial **namespace do tenant** e retorna só imóveis DISPONIVEL do tenant que casam (nunca de outro tenant).
**AC-02 (Isolamento)** — **Dado** o tenant T1, **Quando** a tool de RAG consulta, **Então** usa exclusivamente o namespace de T1 (isolamento reforçado no índice vetorial — nenhum vazamento cross-tenant).
**AC-03 (Edge Case — reindexação)** — **Dado** um imóvel atualizado (`property.updated`), **Quando** o evento chega, **Então** dispara reindexação incremental do documento no namespace do tenant.

### [MOD-AI-10] — Créditos de IA

**AC-01 (Happy Path)** — **Dado** saldo suficiente, **Quando** uma execução consome IA, **Então** faz **reserva** antes da chamada e **converte reserva em uso** ao concluir (transação atômica), reporta `ai.usage_metered` ao billing.
**AC-02 (Sem saldo)** — **Dado** saldo insuficiente, **Quando** tenta executar, **Então** `402`/`403` `ERR_AI_006` "Créditos de IA esgotados" e sugere add-on (MOD-BILLING).
**AC-03 (Edge Case — falha na chamada)** — **Dado** uma reserva feita mas a chamada ao LLM falha, **Quando** ocorre erro, **Então** a reserva é **estornada** (não vira uso), garantindo que falha não cobra crédito.

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| agent_conversations | tenant_id, id | String | ✓ | Isolamento / PK |
| agent_conversations | customer_id | String | — | Pessoa (dedup MOD-CLIENTE) |
| agent_conversations | channel | Enum | ✓ | WHATSAPP, INSTAGRAM, CHAT, EMAIL |
| agent_conversations | status | Enum | ✓ | ATIVA, HANDOFF, ENCERRADA |
| agent_conversations | sentiment | Enum | — | POS, NEU, NEG |
| agent_conversations | unresolved_attempts | Int | ✓ | Contador p/ handoff |
| agent_messages | conversation_id, role, content, tokens, created_at | — | ✓ | Histórico (append-only) |
| agent_context | conversation_id, key, value_json | — | — | Estado do grafo (LangGraph) |
| agent_tool_calls | conversation_id, tool, input, output, status, created_at | — | ✓ | Auditoria de tool (SPEC 9.4) |
| ai_credits | tenant_id, balance, reserved, used, updated_at | — | ✓ | Créditos (transação atômica) |
| rag_index_meta | tenant_id, entity_type, entity_id, indexed_at, namespace | — | ✓ | Metadados de indexação |

### Campos com Criptografia AES-256-GCM
| Campo | Tabela | Justificativa |
|---|---|---|
| content (agent_messages) | agent_messages | Conteúdo de conversa (dado pessoal do cliente) |
| output (agent_tool_calls) | agent_tool_calls | Pode conter dado pessoal/sensível retornado |

### Índices
```sql
CREATE INDEX idx_conv_tenant_status ON agent_conversations(tenant_id, status);
CREATE INDEX idx_conv_customer ON agent_conversations(tenant_id, customer_id);
CREATE INDEX idx_messages_conv ON agent_messages(conversation_id, created_at);
CREATE INDEX idx_toolcalls_conv ON agent_tool_calls(conversation_id, created_at DESC);
CREATE UNIQUE INDEX idx_credits_tenant ON ai_credits(tenant_id);
CREATE INDEX idx_rag_meta ON rag_index_meta(tenant_id, entity_type, entity_id);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| POST | /v1/ai/chat | público(canal)/autenticado | Mensagem de entrada (webhook canal) |
| GET | /v1/ai/conversations | ADMIN, GESTOR, CORRETOR(atribuído) | Listar conversas |
| GET | /v1/ai/conversations/:id | idem | Histórico + tool calls |
| POST | /v1/ai/conversations/:id/handoff | ADMIN, GESTOR, sistema | Forçar handoff |
| POST | /v1/ai/properties/:id/generate-ad | GESTOR, CORRETOR | Gerar anúncio |
| POST | /v1/ai/reports | ADMIN, GESTOR, FINANCEIRO | Relatório em linguagem natural |
| GET | /v1/ai/credits | ADMIN | Saldo de créditos |
| POST | /v1/webhooks/whatsapp | público (assinatura) | Entrada WhatsApp |

```typescript
export const AiChatSchema = z.object({
  channel: z.enum(['WHATSAPP','INSTAGRAM','CHAT','EMAIL']),
  from: z.object({ identifier: z.string(), name: z.string().optional() }),
  message: z.object({ text: z.string(), attachments: z.array(z.string()).optional() }),
})
export const GenerateReportSchema = z.object({
  prompt: z.string().min(3), // "resumo da inadimplência do mês"
  scope: z.enum(['FINANCEIRO','CAPTACAO','LOCACAO','GERAL']),
})
```

### Grafo LangGraph — Chat Agent (nós)

```
classify_intent ─► rag_lookup ─► (execute_action | generate_response) ─► check_handoff ─► respond
       │                                                                      │
       └── estado: { tenantId, channel, customerId, history, retrieved }      └── handoff se sentiment=NEG OU unresolved_attempts>=3
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_AI_001 | 404 | Conversa não encontrada |
| ERR_AI_002 | 422 | Inválido |
| ERR_AI_003 | 403 | Papel insuficiente / tool não permitida |
| ERR_AI_006 | 402 | Créditos de IA esgotados |

## 6. Máquinas de Estado

### Conversa — Status

```
ATIVA ──(sentiment=NEG OU unresolved>=3 OU pedido)──► HANDOFF ──(corretor assume)──► (continua humano)
   │
   └──(resolvida / inatividade)──► ENCERRADA
```

| De | Para | Evento | Efeito | Audit |
|---|---|---|---|---|
| — | ATIVA | `ai_conversation.started` | cria/dedup cliente | ✓ |
| ATIVA | HANDOFF | `ai_conversation.handoff_requested` | alerta corretor + contexto (CRM/broker/notif) | ✓ |
| ATIVA | ENCERRADA | `ai_conversation.closed` | atualiza perfil do cliente (8.8) | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Agentes acessam domínio só via tools tipadas | Nunca query direta; respeita RBAC/tenant | Todos |
| RN-02 | Toda tool call é auditada | `agent_tool_calls` (SPEC 9.4) | MOD-SADMIN |
| RN-03 | Handoff por sentimento NEG OU 3 tentativas | Decisão de negócio | MOD-CRM, MOD-CORRETOR |
| RN-04 | RAG isolado por namespace de tenant | Sem vazamento cross-tenant no índice vetorial | MOD-IMOVEL |
| RN-05 | Reserva de crédito estornada em falha | Falha não cobra | MOD-BILLING |
| RN-06 | Contexto unificado por pessoa entre canais | Dedup por telefone/email/CPF | MOD-CLIENTE |
| RN-07 | Reindexação incremental em mudança de dados | Reage a `property.updated` etc. | MOD-IMOVEL |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `lead.created` | ai-orchestrator | crm, notification | `{ tenantId, customerId, source, timestamp }` |
| `ai_conversation.handoff_requested` | ai-orchestrator | crm, broker, notification | `{ tenantId, conversationId, context }` |
| `ai.usage_metered` | ai-orchestrator | billing | `{ tenantId, tokens, credits, timestamp }` |
| `document.extracted` | ai-orchestrator | document, customer/owner | `{ tenantId, documentId, extraction }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Corretor | AI_AGENT(tools) |
|---|---|---|---|---|---|
| Ver conversas | ✓ | ✓ | ✓ | atribuídas | — |
| Forçar handoff | ✓ | ✓ | ✓ | próprias | — |
| Gerar anúncio/relatório | ✓ | ✓ | ✓ | próprios | — |
| Executar tools de domínio | — | — | — | — | escopo restrito (nunca DELETE/financeiro-escrita) |

### Audit Log
**Rastreabilidade total do agente (SPEC 9.4):** o que foi lido (tool call), o que foi decidido (intenção/handoff), ação tomada e resultado — tudo em `agent_tool_calls`/audit imutável.

### Dados Pessoais (LGPD)

| Campo | Categoria | Base Legal | Retenção | Exportável | Deletável |
|---|---|---|---|---|---|
| conteúdo de conversa | Dado pessoal | Consentimento/legítimo interesse | 24 meses | ✓ | ✓ |
| dados extraídos por OCR | Dado sensível | Consentimento | Igual ao documento | ✓ | ✓ |
| perfil enriquecido por IA | Dado pessoal | Legítimo interesse | Enquanto ativo | ✓ | ✓ |

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Contexto de conversa ativo | 1800s | `ai:ctx:{tenantId}:{convId}` | mensagem nova/encerramento |
| Resultado de recomendação | 120s | `ai:reco:{tenantId}:{profileHash}` | property.status_changed |

### Métricas de Negócio (Pino)
```json
{ "metric": "ai_conversation_resolved", "tenantId": "...", "value": 1, "unit": "count" }
```
- `ai_auto_qualification_rate`: % leads qualificados sem humano.
- `ai_handoff_rate`: % conversas que escalam (por motivo: sentimento vs tentativas).
- `ai_first_response_time`: latência 1ª resposta (SLA da camada de agentes).
- `ai_credits_consumed`: créditos/tenant (reconciliação billing).
- `rag_hit_rate`: recomendações com resultado relevante.

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Provedor de índice vetorial (Pinecone vs pgvector) | RAG, custo, isolamento | Tech Lead | Fase 4 |
| 2 | Modelo LLM padrão e política de custo/latência | Qualidade × custo | Tech Lead | Fase 4 |
| 3 | Provedor WhatsApp Business (Meta Cloud vs BSP) | Canal principal | Tech Lead | Fase 4 (alinhar MOD-NOTIF) |
| 4 | Definição de "sentimento negativo" (limiar/modelo) | Handoff | PM/Tech Lead | Fase 4 |
| 5 | Conversão tokens→créditos e precificação | Billing | PM | Fase 4 |
