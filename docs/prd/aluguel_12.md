# PRD Detalhado — Gestão de Aluguel (Locação)

**Módulo:** MOD-RENTAL
**Arquivo:** 12/20
**Prioridade:** P0
**Fase de Implementação:** 2 (Operação e Financeiro)
**Serviço Backend:** rental-service (`backend/src/modules/rental`, monólito porta 3001)
**Tabelas Principais:** rental_cycles, readjustments, delinquencies, rental_inspections
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** A administração de locação é a receita recorrente da imobiliária: cada contrato de locação gera **ciclos mensais** de cobrança, sofre **reajuste anual** (IPCA padrão, IGP-M opcional — decisão de negócio), pode entrar em **inadimplência** (régua de cobrança) e culmina em renovação ou rescisão, com vistorias de entrada/saída. Automatizar esse ciclo elimina o trabalho manual mês a mês e reduz perdas por inadimplência não tratada.

**Integração sistêmica.** Acionado por `contract.signed` (cria o ciclo de locação). Gera cobranças no MOD-FIN; recebe `payment.received`/`payment.overdue`. Dispara reajuste ao aniversário do contrato (via MOD-CONTRATO/MOD-CRON). Vistorias usam MOD-AGENDA. Publica `rental.cycle_generated`, `rental.readjusted`, `rental.delinquent`.

**Escopo desta fase.** MVP: geração automática de ciclos mensais, reajuste anual por índice, gestão de inadimplência com régua, renovação/rescisão vinculada ao contrato, vistorias de entrada/saída. **Fora desta fase:** cálculo automático de multa rescisória proporcional complexa (usa fórmula do MOD-CONTRATO), integração com seguradora de fiança.

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-RENTAL-01 | Geração de ciclos mensais | Cria cobrança recorrente por competência | Must Have |
| MOD-RENTAL-02 | Reajuste anual | Aplica índice no aniversário (IPCA default) | Must Have |
| MOD-RENTAL-03 | Gestão de inadimplência | Marca e acompanha atraso, aciona régua | Must Have |
| MOD-RENTAL-04 | Renovação/rescisão | Vincula ao ciclo de vida do contrato | Must Have |
| MOD-RENTAL-05 | Vistorias entrada/saída | Vincula vistoria ao contrato de locação | Should Have |

## 3. Critérios de Aceite

### [MOD-RENTAL-01] — Ciclos mensais

**AC-01 (Happy Path)** — **Dado** um contrato de locação VIGENTE, **Quando** o job mensal roda no dia de faturamento, **Então** gera `rental_cycle` da competência e uma cobrança no MOD-FIN, publica `rental.cycle_generated`.
**AC-02 (Idempotência)** — **Dado** o job reexecutado no mesmo mês, **Quando** roda, **Então** **não** duplica o ciclo da competência (unique por contrato+competência).
**AC-03 (Edge Case — contrato encerrado no mês)** — **Dado** um contrato rescindido em D+10, **Quando** o ciclo é gerado, **Então** calcula **pro-rata** dos dias ocupados.

### [MOD-RENTAL-02] — Reajuste

**AC-01 (Happy Path)** — **Dado** um contrato completando 12 meses com índice IPCA, **Quando** o job de reajuste roda, **Então** aplica a variação acumulada do IPCA ao valor, cria `readjustment`, atualiza contrato (nova versão), notifica as partes.
**AC-02 (Opcional IGP-M)** — **Dado** contrato configurado `IGP_M`, **Quando** reajusta, **Então** usa IGP-M em vez de IPCA.
**AC-03 (Edge Case — índice não publicado)** — **Dado** índice do mês ainda indisponível, **Quando** reajusta, **Então** usa o último índice disponível, marca `provisorio=true` e reconcilia quando publicado.

### [MOD-RENTAL-03] — Inadimplência

**AC-01 (Happy Path)** — **Dado** um ciclo vencido sem pagamento, **Quando** chega `payment.overdue`, **Então** cria `delinquency`, publica `rental.delinquent`, inicia régua (MOD-ALERT).
**AC-02 (Edge Case)** — **Dado** um inquilino que paga parcialmente, **Quando** o pagamento parcial é registrado, **Então** o saldo remanescente segue como inadimplência e a régua continua sobre o saldo.

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| rental_cycles | tenant_id, id | String | ✓ | Isolamento / PK |
| rental_cycles | contract_id | String | ✓ | Contrato de locação |
| rental_cycles | competence | String (YYYY-MM) | ✓ | Competência |
| rental_cycles | amount | Decimal | ✓ | Valor do mês (já reajustado) |
| rental_cycles | receivable_id | String | — | Cobrança gerada (MOD-FIN) |
| rental_cycles | status | Enum | ✓ | GERADO, PAGO, INADIMPLENTE, PRO_RATA |
| readjustments | contract_id, index, old_value, new_value, applied_at, provisorio | — | ✓ | Histórico de reajuste |
| delinquencies | tenant_id, cycle_id, days_late, amount_due, stage, status | — | ✓ | Inadimplência |
| rental_inspections | contract_id, type, appointment_id, report_json | — | — | Vistoria entrada/saída |

### Índices
```sql
CREATE UNIQUE INDEX idx_cycle_contract_comp ON rental_cycles(contract_id, competence);
CREATE INDEX idx_cycles_tenant_status ON rental_cycles(tenant_id, status);
CREATE INDEX idx_delinquencies_tenant ON delinquencies(tenant_id, status, days_late);
CREATE INDEX idx_readjust_contract ON readjustments(contract_id, applied_at DESC);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/rental-cycles | ADMIN, GESTOR, FINANCEIRO | Listar (por contrato/competência) |
| GET | /v1/rental-cycles/:id | idem + Portal(inquilino) | Detalhe |
| POST | /v1/contracts/:id/readjust | ADMIN, GESTOR | Forçar reajuste (manual) |
| GET | /v1/delinquencies | ADMIN, GESTOR, FINANCEIRO | Inadimplências |
| POST | /v1/rental-inspections | GESTOR, CORRETOR | Registrar vistoria |

```typescript
export const ReadjustSchema = z.object({
  index: z.enum(['IPCA','IGP_M','INPC','FIXO']).optional(),
  effectiveDate: z.string().date().optional(),
})
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_RENTAL_001 | 404 | Não encontrado |
| ERR_RENTAL_002 | 422 | Inválido |
| ERR_RENTAL_003 | 403 | Papel insuficiente |
| ERR_RENTAL_004 | 409 | Ciclo duplicado / reajuste antes do aniversário |

## 6. Máquinas de Estado

### Rental Cycle — Status

```
GERADO ──(payment.received)──► PAGO
   │
   ├──(pro-rata rescisão)──► PRO_RATA ──(payment.received)──► PAGO
   │
   └──(vencido)──► INADIMPLENTE ──(payment.received)──► PAGO
                        │
                        └──(régua D+30)──► (ação jurídica/rescisão → MOD-CONTRATO)
```

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| — | GERADO | `rental.cycle_generated` | financeiro | ✓ |
| GERADO | INADIMPLENTE | `rental.delinquent` | régua (MOD-ALERT) | ✓ |
| — | (reajuste) | `rental.readjusted` | partes do contrato | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Ciclo único por contrato+competência | Índice unique; job idempotente | MOD-CRON, MOD-FIN |
| RN-02 | Reajuste IPCA padrão, IGP-M opcional | `readjust_index` do contrato | MOD-CONTRATO |
| RN-03 | Índice indisponível → provisório + reconciliação | Flag `provisorio` | — |
| RN-04 | Rescisão no meio do mês → pro-rata | Cálculo por dias | MOD-FIN |
| RN-05 | Pagamento parcial mantém inadimplência do saldo | Régua sobre saldo | MOD-ALERT |
| RN-06 | Repasse ao proprietário só após compensação | Alinhado ao MOD-FIN | MOD-FIN, MOD-OWNER |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `rental.cycle_generated` | rental | financial, notification | `{ tenantId, cycleId, contractId, competence, amount }` |
| `rental.readjusted` | rental | contract, notification | `{ tenantId, contractId, index, newValue }` |
| `rental.delinquent` | rental | notification (régua), ai-orchestrator | `{ tenantId, cycleId, daysLate, amountDue }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Financeiro | Corretor | Portal(Inquilino) |
|---|---|---|---|---|---|---|
| Ver ciclos | ✓ | ✓ | ✓ | ✓ | — | próprios |
| Forçar reajuste | ✓ | ✓ | ✓ | — | — | — |
| Ver inadimplência | ✓ | ✓ | ✓ | ✓ | — | próprias |
| Registrar vistoria | ✓ | ✓ | ✓ | — | ✓ | — |

### Audit Log
`rental.cycle_generated`, `rental.readjusted`, `delinquency.opened`, `inspection.recorded`.

### Dados Pessoais (LGPD)
Ciclos referenciam contrato/inquilino; dados financeiros com retenção fiscal de 5 anos. Vistorias podem conter fotos (evidência contratual).

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Índices econômicos (IPCA/IGP-M) do mês | 24h | `idx:{index}:{YYYY-MM}` | nova publicação |

### Métricas
- `rental_active_contracts`: contratos de locação ativos.
- `delinquency_rate`: % ciclos inadimplentes.
- `readjustment_applied`: reajustes aplicados/mês.

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Fonte oficial dos índices (API IBGE/FGV) | Automação de reajuste | Tech Lead | Fase 2 |
| 2 | Dia de faturamento: fixo global vs por contrato | Ciclos | PM | Fase 2 |
| 3 | Integração com seguradora de fiança | Garantia | PM | Fase 3 |
