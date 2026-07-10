# PRD Detalhado — Gestão de Contratos

**Módulo:** MOD-CONTRATO
**Arquivo:** 08/20
**Prioridade:** P0
**Fase de Implementação:** 1 (Core de Gestão)
**Serviço Backend:** contract-service (`backend/src/modules/contract`, monólito porta 3001)
**Tabelas Principais:** contracts, contract_templates, contract_versions, contract_parties, contract_clauses, contract_guarantees
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** O contrato formaliza cada negócio (locação, venda, intermediação, prestação de serviço) e é o **gatilho de todo o financeiro**: ao ser assinado, dispara a primeira cobrança, define reajuste, garantia e vínculos. Templates configuráveis por tenant com cláusulas dinâmicas reduzem o trabalho jurídico manual. É documento com valor legal — versionamento e integridade são obrigatórios.

**Integração sistêmica.** Consome MOD-IMOVEL, MOD-OWNER, MOD-CLIENTE, MOD-CORRETOR (partes e objeto). É **upstream crítico** de `financial-service` (`contract.signed` → primeira cobrança/repasse/comissão), `rental-service` (ciclo de locação, reajuste **IPCA padrão, IGP-M opcional** conforme decisão), `document-service` (PDF gerado via Gotenberg). Publica `contract.signed`, `contract.renewed`, `contract.terminated`.

**Escopo desta fase.** MVP: templates com variáveis `{{...}}`, cláusulas dinâmicas (reajuste, garantia: fiador/caução/seguro-fiança/título de capitalização), ciclo de vida completo, geração de PDF, versionamento imutável. **Renovação automática opt-out** (renova salvo cancelamento prévio) é a política padrão. **Fora desta fase:** assinatura eletrônica integrada (avaliar provedor futuro; MVP registra assinatura manual/upload do assinado).

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-CONTRATO-01 | Templates configuráveis | Modelos por tenant com variáveis `{{entidade.campo}}` | Must Have |
| MOD-CONTRATO-02 | CRUD contrato + partes | Contrato vinculado a imóvel/partes/corretor | Must Have |
| MOD-CONTRATO-03 | Cláusulas dinâmicas | Reajuste (índice), garantia, multas | Must Have |
| MOD-CONTRATO-04 | Ciclo de vida | rascunho→em assinatura→vigente→renovação/encerramento | Must Have |
| MOD-CONTRATO-05 | Geração de PDF | HTML template → Gotenberg → PDF versionado | Must Have |
| MOD-CONTRATO-06 | Versionamento imutável | Cada versão gravada (create-only), comparação | Must Have |
| MOD-CONTRATO-07 | Renovação automática (opt-out) | Renova ao vencimento salvo cancelamento prévio | Must Have |
| MOD-CONTRATO-08 | Biblioteca de cláusulas | Catálogo reutilizável (nome + texto) para montar contratos | Must Have |
| MOD-CONTRATO-09 | Cadastro de fiadores | Vínculo de fiador(es) ao contrato (ver [[fiadores_21]]) | Must Have |

## 3. Critérios de Aceite

### [MOD-CONTRATO-04] — Ciclo de vida

**AC-01 (Happy Path)** — **Dado** um contrato de locação em `EM_ASSINATURA` com todas as partes, **Quando** todas assinam (ou upload do assinado), **Então** vira `VIGENTE`, imóvel vai a `ALUGADO`, publica `contract.signed` (que dispara 1ª cobrança/repasse/comissão) (200).
**AC-02 (Validação)** — **Dado** um contrato de locação **sem garantia definida**, **Quando** tenta ir a `EM_ASSINATURA`, **Então** `422` `ERR_CONTRATO_002` "Garantia obrigatória para locação".
**AC-03 (Edge Case)** — **Dado** um contrato `VIGENTE`, **Quando** tenta editar valor diretamente, **Então** `409` `ERR_CONTRATO_004` "Contrato vigente é imutável; use aditivo/renovação".

### [MOD-CONTRATO-07] — Renovação automática (opt-out)

**AC-01 (Happy Path)** — **Dado** um contrato vigente a 30 dias do vencimento sem cancelamento registrado, **Quando** o job de renovação roda, **Então** gera nova versão `RENOVADO` aplicando reajuste do índice (IPCA padrão), notifica as partes.
**AC-02 (Opt-out)** — **Dado** um cancelamento de renovação registrado antes de D-30, **Quando** o job roda, **Então** o contrato segue para `ENCERRADO` no vencimento, **sem** renovar.
**AC-03 (Edge Case — índice indisponível)** — **Dado** que o índice de reajuste do mês ainda não foi publicado, **Quando** a renovação tenta calcular, **Então** usa o **último índice disponível** e marca `reajuste_provisorio=true` para reconciliação posterior.

### [MOD-CONTRATO-01] — Templates

**AC-01 (Happy Path)** — **Dado** um template com `{{cliente.nome}}` e `{{imovel.endereco}}`, **Quando** gera contrato, **Então** variáveis são substituídas pelos valores reais das entidades vinculadas.
**AC-02 (Validação)** — **Dado** uma variável inexistente `{{foo.bar}}`, **Quando** valida o template, **Então** `422` `ERR_CONTRATO_002` listando variáveis desconhecidas.

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| contracts | tenant_id, id | String | ✓ | Isolamento / PK |
| contracts | type | Enum | ✓ | LOCACAO, VENDA, INTERMEDIACAO, SERVICO |
| contracts | property_id | String | ✓ | Objeto |
| contracts | status | Enum | ✓ | RASCUNHO, EM_ASSINATURA, VIGENTE, RENOVADO, ENCERRADO, DISTRATADO |
| contracts | starts_at, ends_at | Date | ✓ | Vigência |
| contracts | rental_value | Decimal | — | Valor (locação) |
| contracts | readjust_index | Enum | — | IPCA (default), IGP_M, INPC, FIXO |
| contracts | auto_renew | Boolean | ✓ | Opt-out (default true) |
| contracts | current_version | Int | ✓ | Versão vigente |
| contract_parties | contract_id, role, party_type, party_id, signed_at | — | ✓ | LOCADOR/LOCATARIO/CORRETOR/FIADOR (party_type FIADOR → FK `guarantors` do [[fiadores_21]]) |
| contract_guarantees | contract_id, kind, guarantor_id, details_json | — | — | FIADOR (→ `guarantors`), CAUCAO, SEGURO_FIANCA, TITULO_CAP |
| contract_clauses | contract_id, key, content, clause_library_id | — | ✓ | Cláusulas resolvidas (opcionalmente originadas do catálogo) |
| clause_library | tenant_id, id, name, content, active | — | ✓ | **Catálogo reutilizável de cláusulas** (nome + descrição). Espelha a tela legada "Cadastro de Cláusulas" |
| contract_versions | contract_id, version, snapshot_json, pdf_url, created_at | — | ✓ | Imutável |
| contract_templates | tenant_id, id, name, html, variables[] | — | ✓ | Template do tenant |

### Índices
```sql
CREATE INDEX idx_contracts_tenant ON contracts(tenant_id);
CREATE INDEX idx_contracts_tenant_status ON contracts(tenant_id, status);
CREATE INDEX idx_contracts_ends_at ON contracts(tenant_id, ends_at) WHERE status='VIGENTE';
CREATE INDEX idx_contract_versions ON contract_versions(contract_id, version DESC);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/contracts | ADMIN, GESTOR, FINANCEIRO, CORRETOR(próprios) | Listar |
| POST | /v1/contracts | ADMIN, GESTOR, CORRETOR | Criar rascunho |
| GET | /v1/contracts/:id | idem + Portal(parte) | Detalhe |
| PATCH | /v1/contracts/:id | ADMIN, GESTOR (só RASCUNHO) | Editar |
| POST | /v1/contracts/:id/send-to-sign | ADMIN, GESTOR | RASCUNHO → EM_ASSINATURA |
| POST | /v1/contracts/:id/sign | ADMIN, GESTOR, Portal(parte) | Registrar assinatura |
| POST | /v1/contracts/:id/terminate | ADMIN, GESTOR | Distrato/encerramento |
| GET | /v1/contracts/:id/pdf | idem + Portal(parte) | PDF da versão vigente |
| GET | /v1/contract-templates | ADMIN, GESTOR | Templates |
| POST | /v1/contract-templates | ADMIN, GESTOR | Criar template |

```typescript
export const CreateContractSchema = z.object({
  type: z.enum(['LOCACAO','VENDA','INTERMEDIACAO','SERVICO']),
  propertyId: z.string(),
  templateId: z.string(),
  parties: z.array(z.object({
    role: z.enum(['LOCADOR','LOCATARIO','CORRETOR','FIADOR','VENDEDOR','COMPRADOR']),
    partyType: z.enum(['OWNER','CUSTOMER','BROKER']),
    partyId: z.string(),
  })).min(2),
  startsAt: z.string().date(),
  endsAt: z.string().date(),
  rentalValue: z.number().positive().optional(),
  readjustIndex: z.enum(['IPCA','IGP_M','INPC','FIXO']).default('IPCA'),
  guarantee: z.object({ kind: z.enum(['FIADOR','CAUCAO','SEGURO_FIANCA','TITULO_CAP']), details: z.record(z.any()) }).optional(),
  autoRenew: z.boolean().default(true),
}).refine(d => d.type !== 'LOCACAO' || d.guarantee, { message: 'Garantia obrigatória p/ locação' })
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_CONTRATO_001 | 404 | Não encontrado |
| ERR_CONTRATO_002 | 422 | Inválido (garantia/variável/vigência) |
| ERR_CONTRATO_003 | 403 | Papel insuficiente |
| ERR_CONTRATO_004 | 409 | Estado inválido (editar vigente) |

## 6. Máquinas de Estado

### Contrato — Status

```
RASCUNHO ──(send-to-sign, garantia OK)──► EM_ASSINATURA ──(todas as partes assinam)──► VIGENTE
   │                                            │                                        │
   │(descartar)                                 │(recusa/expira)                          ├─(auto-renew D-30)──► RENOVADO ──► VIGENTE(nova versão)
   ▼                                            ▼                                        │
DESCARTADO                                  RASCUNHO                                     ├─(vencimento sem renovar)──► ENCERRADO
                                                                                         └─(distrato antecipado)──► DISTRATADO
```

**Efeitos colaterais:**

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| EM_ASSINATURA | VIGENTE | `contract.signed` | financeiro, partes, imóvel→ALUGADO/VENDIDO | ✓ |
| VIGENTE | RENOVADO | `contract.renewed` | partes (novo valor reajustado) | ✓ |
| VIGENTE | ENCERRADO/DISTRATADO | `contract.terminated` | financeiro (encerrar cobranças), imóvel→DISPONIVEL | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | `contract.signed` dispara 1ª cobrança + repasse + comissão | Evento único orquestra financeiro | MOD-FIN, MOD-RENTAL, MOD-CORRETOR |
| RN-02 | Contrato vigente é imutável | Alterações só via aditivo (nova versão) | MOD-DOC |
| RN-03 | Reajuste padrão IPCA, IGP-M opcional por contrato | `readjust_index` default IPCA | MOD-RENTAL |
| RN-04 | Renovação opt-out (auto_renew=true default) | Renova salvo cancelamento antes de D-30 | MOD-CRON |
| RN-05 | Índice do mês indisponível na renovação | Usa último índice + flag provisório | MOD-RENTAL |
| RN-06 | Locação exige garantia | Bloqueia envio a assinatura sem garantia | — |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `contract.signed` | contract | financial, rental, document, notification, property | `{ tenantId, contractId, type, propertyId, value, timestamp }` |
| `contract.renewed` | contract | financial, rental, notification | `{ tenantId, contractId, newValue, index, timestamp }` |
| `contract.terminated` | contract | financial, property, notification | `{ tenantId, contractId, reason, timestamp }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Financeiro | Corretor | Portal(Parte) |
|---|---|---|---|---|---|---|
| Listar | ✓ | ✓ | ✓ | ✓ | próprios | próprios |
| Criar | ✓ | ✓ | ✓ | — | ✓ | — |
| Enviar/assinar | ✓ | ✓ | ✓ | — | — | própria assinatura |
| Encerrar/distrato | ✓ | ✓ | ✓ | — | — | — |

### Audit Log
`contract.created/signed/renewed/terminated`, `template.updated`, geração de PDF → imutável (valor legal).

### Dados Pessoais (LGPD)

| Campo | Categoria | Base Legal | Retenção | Exportável | Deletável |
|---|---|---|---|---|---|
| partes (CPF/dados) | Dado pessoal | Execução de contrato | Vigência + 5 anos (prazo prescricional) | ✓ | — (obrigação legal) |
| PDF do contrato | Documento legal | Obrigação legal | 5 anos pós-encerramento | ✓ | — |

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Template renderizado | 300s | `tpl:{tenantId}:{templateId}` | template.updated |

### Métricas
- `contracts_signed`: contratos assinados/mês por tipo.
- `contract_renewal_rate`: % renovação vs encerramento.
- `pdf_generation_latency`: latência Gotenberg (p95).

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Provedor de assinatura eletrônica (Clicksign/D4Sign/…) | Legalidade, UX | PM/Jurídico | Fase 2 |
| 2 | Multa de rescisão: fórmula padrão configurável | Financeiro | PM/Financeiro | Fase 1 |
| 3 | Aditivo contratual como entidade separada ou versão? | Modelagem | Tech Lead | Fase 1 |
