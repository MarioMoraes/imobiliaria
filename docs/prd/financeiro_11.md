# PRD Detalhado — Gestão Financeira Completa

**Módulo:** MOD-FIN
**Arquivo:** 11/20
**Prioridade:** P0
**Fase de Implementação:** 2 (Operação e Financeiro)
**Serviço Backend:** financial-service (`backend/src/modules/financial`, monólito porta 3001)
**Tabelas Principais:** receivables, payables, transfers (repasses), commissions, cash_flow_entries, asaas_charges, accounting_categories
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** O financeiro é o coração operacional da imobiliária administradora: contas a receber/pagar, emissão de cobranças (Asaas), **repasse ao proprietário** (após compensação do pagamento do inquilino, conforme decisão de negócio) com dedução da taxa de administração, comissões de corretores e fluxo de caixa. Erros aqui têm impacto direto no dinheiro de terceiros — exige precisão, idempotência e auditoria.

**Integração sistêmica.** Acionado por `contract.signed` (gera 1ª cobrança/repasse/comissão) e por `payment.received`/`payment.overdue` (Asaas → MOD-PAY webhook, ver módulo de gateway embutido aqui). Consome MOD-OWNER (conta de repasse), MOD-CORRETOR (regra de comissão), MOD-RENTAL (ciclo de locação). Publica `payment.received`, `payment.overdue`, `transfer.executed`, `commission.due`.

**Escopo desta fase.** MVP: contas a receber/pagar, integração Asaas (boleto/PIX/cartão) com webhook idempotente, cálculo e execução de repasse pós-compensação, comissões, fluxo de caixa, DRE simplificado, régua de cobrança. **Fora desta fase:** conciliação bancária automática por OFX, integração contábil/fiscal completa (NFS-e), split nativo Asaas multi-recebedor (avaliar).

> **Nota:** o gateway de pagamento (webhooks Asaas, split, idempotência) é tratado em detalhe como parte deste módulo financeiro. A régua de reembolso: **sem reembolso após confirmação** salvo direito de arrependimento legal quando aplicável — decisão a confirmar (ver Questões em Aberto).

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-FIN-01 | Contas a receber | Cobranças de aluguel/venda/serviço | Must Have |
| MOD-FIN-02 | Contas a pagar | Despesas do tenant | Must Have |
| MOD-FIN-03 | Integração Asaas + webhook idempotente | Emissão de boleto/PIX e baixa por webhook | Must Have |
| MOD-FIN-04 | Repasse ao proprietário | Cálculo (valor − taxa adm) + execução pós-compensação | Must Have |
| MOD-FIN-05 | Comissões | Cálculo por regra e lançamento | Must Have |
| MOD-FIN-06 | Fluxo de caixa | Entradas/saídas consolidadas | Must Have |
| MOD-FIN-07 | DRE simplificado | Receita bruta − descontos − inadimplência − custos | Should Have |
| MOD-FIN-08 | Régua de cobrança | Sequência D+0→D+30 de alertas de inadimplência | Must Have |

## 3. Critérios de Aceite

### [MOD-FIN-03] — Webhook Asaas idempotente

**AC-01 (Happy Path)** — **Dado** uma cobrança emitida, **Quando** chega webhook `PAYMENT_RECEIVED` com `gatewayEventId` novo, **Então** faz **upsert** por `gatewayEventId`, baixa o receivable, publica `payment.received` (200).
**AC-02 (Idempotência)** — **Dado** o **mesmo** webhook reenviado (`gatewayEventId` repetido), **Quando** chega, **Então** é reconhecido como duplicata (upsert não-op), retorna 200 **sem** baixar duas vezes.
**AC-03 (Edge Case — assinatura inválida)** — **Dado** um webhook com assinatura HMAC inválida, **Quando** chega, **Então** `401` e o evento é descartado + logado (proteção contra forjamento).

### [MOD-FIN-04] — Repasse pós-compensação

**AC-01 (Happy Path)** — **Dado** um aluguel pago e **compensado** (`payment.received`), **Quando** o job de repasse roda, **Então** calcula `repasse = valor_pago − taxa_administracao`, cria `transfer` para a conta padrão do proprietário e executa via Asaas, publica `transfer.executed`.
**AC-02 (Validação)** — **Dado** proprietário sem conta de repasse cadastrada, **Quando** o repasse seria gerado, **Então** fica `PENDENTE_CONTA`, alerta o financeiro (não executa).
**AC-03 (Edge Case — pagamento estornado)** — **Dado** um pagamento estornado **após** repasse executado, **Quando** chega `PAYMENT_REFUNDED`, **Então** cria lançamento de **estorno de repasse** (a recuperar do proprietário) e alerta — nunca deixa o caixa inconsistente.

### [MOD-FIN-08] — Régua de cobrança

**AC-01 (Happy Path)** — **Dado** um receivable vencido, **Quando** os jobs rodam em D+1, D+3, D+7, D+15, **Então** cada etapa dispara alerta pelo canal configurado (MOD-ALERT/NOTIF) com tom escalonado.
**AC-02 (Edge Case)** — **Dado** pagamento em D+5, **Quando** ocorre, **Então** as etapas seguintes (D+7, D+15) são **canceladas** automaticamente.

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| receivables | tenant_id, id | String | ✓ | Isolamento / PK |
| receivables | contract_id | String | — | Origem |
| receivables | amount, due_date | Decimal/Date | ✓ | Valor e vencimento |
| receivables | status | Enum | ✓ | ABERTO, PAGO, VENCIDO, CANCELADO, ESTORNADO |
| receivables | asaas_charge_id | String | — | ID no gateway |
| payables | tenant_id, id, amount, due_date, status, category_id | — | ✓ | Contas a pagar |
| transfers | tenant_id, id, owner_id, contract_id, gross, admin_fee, net, status, bank_account_snapshot | — | ✓ | Repasse |
| commissions | tenant_id, id, broker_id, contract_id, pct_snapshot, amount, status | — | ✓ | Comissão |
| asaas_charges | tenant_id, id, asaas_id, gateway_event_id, status, raw_json | — | ✓ | Espelho de cobrança |
| webhook_events | gateway_event_id (unique), processed_at, payload | — | ✓ | Idempotência |
| cash_flow_entries | tenant_id, date, type, amount, category_id, ref | — | ✓ | Fluxo de caixa |

### Campos com Criptografia AES-256-GCM
| Campo | Tabela | Justificativa |
|---|---|---|
| bank_account_snapshot | transfers | Dado bancário do proprietário no momento do repasse |
| raw_json | asaas_charges | Pode conter dado pessoal do pagador |

### Índices
```sql
CREATE INDEX idx_receivables_tenant_status ON receivables(tenant_id, status, due_date);
CREATE UNIQUE INDEX idx_webhook_event ON webhook_events(gateway_event_id);
CREATE INDEX idx_transfers_owner ON transfers(tenant_id, owner_id, status);
CREATE INDEX idx_commissions_broker ON commissions(tenant_id, broker_id, status);
CREATE INDEX idx_cashflow_tenant_date ON cash_flow_entries(tenant_id, date);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/receivables | ADMIN, GESTOR, FINANCEIRO | Listar |
| POST | /v1/receivables | ADMIN, FINANCEIRO | Criar cobrança (emite Asaas) |
| GET | /v1/payables | ADMIN, FINANCEIRO | Listar |
| GET | /v1/transfers | ADMIN, FINANCEIRO, Portal(Proprietário próprio) | Repasses |
| POST | /v1/transfers/:id/execute | ADMIN, FINANCEIRO | Executar repasse manual |
| GET | /v1/commissions | ADMIN, FINANCEIRO, CORRETOR(próprias) | Comissões |
| GET | /v1/cash-flow | ADMIN, FINANCEIRO | Fluxo de caixa |
| GET | /v1/reports/dre | ADMIN, FINANCEIRO | DRE simplificado |
| POST | /v1/webhooks/asaas | público (HMAC) | Webhook de pagamento |

```typescript
export const CreateReceivableSchema = z.object({
  contractId: z.string().optional(),
  payerCustomerId: z.string(),
  amount: z.number().positive(),
  dueDate: z.string().date(),
  method: z.enum(['BOLETO','PIX','CARTAO']),
})
export const AsaasWebhookSchema = z.object({
  event: z.string(),
  payment: z.object({ id: z.string(), status: z.string(), value: z.number() }),
}) // gatewayEventId derivado do header/id do evento
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_FIN_001 | 404 | Não encontrado |
| ERR_FIN_002 | 422 | Inválido |
| ERR_FIN_003 | 403 | Papel insuficiente |
| ERR_FIN_004 | 409 | Estado inválido (baixar cobrança já paga) |
| ERR_FIN_005 | 401 | Assinatura de webhook inválida |

## 6. Máquinas de Estado

### Receivable — Status

```
ABERTO ──(payment.received)──► PAGO ──(refund)──► ESTORNADO
   │
   ├──(vencimento)──► VENCIDO ──(payment.received)──► PAGO
   │                     │
   │                     └──(régua D+30 sem pagar)──► (inadimplência → MOD-RENTAL)
   └──(cancelar)──► CANCELADO
```

### Transfer (Repasse) — Status

```
PENDENTE ──(sem conta)──► PENDENTE_CONTA ──(conta cadastrada)──► PENDENTE
   │
   └──(pagamento compensado + executa)──► EXECUTADO ──(estorno origem)──► A_RECUPERAR
```

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| ABERTO | PAGO | `payment.received` | cliente (recibo), MOD-RENTAL | ✓ |
| ABERTO | VENCIDO | `payment.overdue` | régua de cobrança (MOD-ALERT) | ✓ |
| PENDENTE | EXECUTADO | `transfer.executed` | proprietário (portal) | ✓ |
| — | (comissão) | `commission.due` | corretor | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Webhook idempotente por `gateway_event_id` | Upsert, nunca dupla baixa | MOD-PAY |
| RN-02 | Repasse só após compensação do pagamento | Reduz risco financeiro (decisão de negócio) | MOD-OWNER, MOD-RENTAL |
| RN-03 | Taxa de administração deduzida no repasse | `net = gross − admin_fee` (config por contrato) | MOD-CONTRATO |
| RN-04 | Comissão usa snapshot da regra no fechamento | Congela `pct` em `contract.signed` | MOD-CORRETOR |
| RN-05 | Estorno pós-repasse gera A_RECUPERAR | Nunca caixa inconsistente | — |
| RN-06 | Régua cancela etapas ao pagar | Idempotência de alertas | MOD-ALERT |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `payment.received` | financial | rental, notification, ai-orchestrator | `{ tenantId, receivableId, amount, timestamp }` |
| `payment.overdue` | financial | rental, notification (régua) | `{ tenantId, receivableId, daysLate }` |
| `transfer.executed` | financial | portal, notification | `{ tenantId, transferId, ownerId, net }` |
| `commission.due` | financial | broker, notification | `{ tenantId, commissionId, brokerId, amount }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Financeiro | Corretor | Portal(Prop.) |
|---|---|---|---|---|---|---|
| Ver receivables | ✓ | ✓ | leitura | ✓ | — | — |
| Criar cobrança | ✓ | ✓ | — | ✓ | — | — |
| Executar repasse | ✓ | ✓ | — | ✓ | — | — |
| Ver comissões | ✓ | ✓ | ✓ | ✓ | próprias | — |
| Ver repasses | ✓ | ✓ | ✓ | ✓ | — | próprios |

### Audit Log
`receivable.created`, `payment.received`, `transfer.executed`, `commission.paid`, `webhook.processed` → imutável (valor financeiro/contábil).

### Dados Pessoais (LGPD)

| Campo | Categoria | Base Legal | Retenção | Exportável | Deletável |
|---|---|---|---|---|---|
| dados de pagamento | Dado financeiro | Execução/obrigação legal (fiscal) | 5 anos (fiscal) | ✓ | — |
| conta de repasse (snapshot) | Dado sensível | Execução de contrato | 5 anos | ✓ | — |

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Resumo financeiro do tenant | 120s | `fin:summary:{tenantId}` | payment/transfer events |

### Métricas
- `revenue_received`: receita recebida/mês por tenant.
- `default_rate`: % inadimplência (VENCIDO/total).
- `transfer_latency`: dias entre compensação e repasse.
- `webhook_dedup_hits`: webhooks duplicados evitados (saúde de idempotência).

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Política de reembolso definitiva (arrependimento 7d vs sem reembolso) | Régua financeira | PM/Jurídico | Fase 2 |
| 2 | Split nativo Asaas multi-recebedor vs repasse manual | Fluxo de repasse | Tech Lead/Financeiro | Fase 2 |
| 3 | Emissão de NFS-e integrada em qual fase? | Fiscal | PM | Fase 3 |
| 4 | Taxa de administração fixa vs por contrato | Modelagem | PM | Fase 1 |
