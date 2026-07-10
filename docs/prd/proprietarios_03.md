# PRD Detalhado — Cadastro de Proprietários

**Módulo:** MOD-OWNER
**Arquivo:** 03/20
**Prioridade:** P0
**Fase de Implementação:** 1 (Core de Gestão)
**Serviço Backend:** owner-service (`backend/src/modules/owner`, monólito porta 3001)
**Tabelas Principais:** owners, owner_bank_accounts, owner_documents, owner_consents, property_owners
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** O proprietário é quem confia seu patrimônio à imobiliária. O cadastro precisa dos dados bancários (para repasse de aluguel) e documentos, ambos **dados sensíveis** sob LGPD. Um erro de dado bancário resulta em repasse para conta errada — problema financeiro e de confiança grave. O módulo também alimenta o **Portal do Proprietário** (transparência de repasses/vistorias).

**Integração sistêmica.** Upstream de `property-service` (vínculo imóvel↔proprietário), `financial-service` (repasses usam `owner_bank_accounts`), `contract-service` (proprietário é parte). Consumido pelo `portal-service`. Publica `owner.created`, `owner.bank_account_updated`.

**Escopo desta fase.** MVP: CRUD de PF e PJ, múltiplas contas bancárias com uma marcada como padrão de repasse, documentos, consentimento LGPD e preferências de contato, histórico de repasses (via consulta ao MOD-FIN). **Fora desta fase:** validação automática de conta bancária (só formato), score de crédito do proprietário.

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-OWNER-01 | CRUD proprietário (PF/PJ) | Cadastro com CPF/CNPJ, contato, endereço | Must Have |
| MOD-OWNER-02 | Contas bancárias | Múltiplas contas, uma padrão para repasse | Must Have |
| MOD-OWNER-03 | Documentos | Upload vinculado (via MOD-DOC) | Must Have |
| MOD-OWNER-04 | Consentimento LGPD | Registro de consentimento e preferências de contato | Must Have |
| MOD-OWNER-05 | Vínculo com imóveis | Lista de imóveis e % de participação | Must Have |
| MOD-OWNER-06 | Histórico de repasses | Agrega dados do MOD-FIN por proprietário | Should Have |

## 3. Critérios de Aceite

### [MOD-OWNER-01] — CRUD proprietário

**AC-01 (Happy Path)** — **Dado** um GESTOR, **Quando** `POST /v1/owners` com CPF válido e contato, **Então** cria com `status=ATIVO`, publica `owner.created` (201).
**AC-02 (Validação)** — **Dado** CPF inválido (dígito verificador), **Quando** submete, **Então** `422` `ERR_OWNER_002` "CPF inválido".
**AC-03 (Edge Case)** — **Dado** CPF já cadastrado no tenant, **Quando** cria, **Então** `409` `ERR_OWNER_004` "Proprietário já cadastrado" com link ao existente.

### [MOD-OWNER-02] — Contas bancárias

**AC-01 (Happy Path)** — **Dado** um proprietário, **Quando** `POST /v1/owners/:id/bank-accounts` com `isDefault=true`, **Então** grava criptografado e desmarca a conta padrão anterior (201).
**AC-02 (Validação)** — **Dado** chave PIX inválida, **Quando** submete, **Então** `422` `ERR_OWNER_002`.
**AC-03 (Edge Case)** — **Dado** proprietário com contrato ativo de repasse, **Quando** tenta deletar a **única** conta padrão, **Então** `409` `ERR_OWNER_005` "Não é possível remover a conta de repasse ativa".

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| owners | tenant_id, id | String | ✓ | Isolamento / PK |
| owners | person_type | Enum | ✓ | PF, PJ |
| owners | cpf_cnpj | String (criptografado) | ✓ | Único por tenant (CPF ou CNPJ/"CGC") |
| owners | full_name | String | ✓ | Nome/razão social |
| owners | rg, rg_issuer | String (criptografado) | — | RG + órgão expedidor (PF) |
| owners | gender | Enum | — | M, F, OUTRO (campo "Sexo" do legado) |
| owners | birth_date | Date | — | Data de nascimento |
| owners | marital_status | Enum | — | SOLTEIRO, CASADO, DIVORCIADO, VIUVO, UNIAO_ESTAVEL |
| owners | nationality | String | — | Nacionalidade (default BRASILEIRA) |
| owners | occupation | String | — | Profissão |
| owners | email, phone, mobile, fax | String (criptografado) | — | Contatos |
| owners | receipt_authorization | Text | — | "Autorização de Recebimento" (quem pode receber o repasse) |
| owners | notes, references | Text | — | Observações e Referências |
| owners | status | Enum | ✓ | ATIVO, INATIVO |
| owner_spouse | owner_id, name, occupation, birth_date, cpf, rg | — | — | Dados do **cônjuge** (criptografado onde aplicável) |
| owner_addresses | owner_id, kind, street, number, district, city, state, zip | — | ✓ | kind: RESIDENCIAL / COMERCIAL (dois blocos, como no legado) |
| owner_bank_accounts | owner_id | String | ✓ | FK |
| owner_bank_accounts | bank, agency, account (criptografado) | String | ✓ | Dados bancários |
| owner_bank_accounts | holder_name (criptografado) | String | — | Titular da conta ("Titular" do legado) |
| owner_bank_accounts | pix_key (criptografado) | String | — | Chave PIX |
| owner_bank_accounts | is_default | Boolean | ✓ | Conta de repasse padrão |
| owner_consents | owner_id, purpose, granted, granted_at, ip | — | ✓ | Consentimento LGPD |

> **Ficha cadastral de pessoa (compat. legado):** os campos pessoais + cônjuge + endereços (residencial/comercial) acima formam a **"ficha de pessoa" PF/PJ** reutilizada de forma idêntica por [[clientes_04]] (locatário) e [[fiadores_21]] (fiador). Recomenda-se um **tipo compartilhado** (`PersonRecord` em `@move-ai/shared`) para os três cadastros.

### Campos com Criptografia AES-256-GCM

| Campo | Tabela | Justificativa |
|---|---|---|
| cpf_cnpj, rg | owners | Dado pessoal identificável (LGPD) |
| email, phone, mobile, fax | owners | Dado pessoal |
| cpf, rg (cônjuge) | owner_spouse | Dado pessoal de terceiro |
| account, agency, pix_key, holder_name | owner_bank_accounts | Dado financeiro sensível |

### Índices

```sql
CREATE INDEX idx_owners_tenant ON owners(tenant_id);
CREATE UNIQUE INDEX idx_owners_tenant_doc ON owners(tenant_id, cpf_cnpj);
CREATE INDEX idx_owner_bank_owner ON owner_bank_accounts(owner_id);
CREATE UNIQUE INDEX idx_owner_default_account ON owner_bank_accounts(owner_id) WHERE is_default;
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/owners | ADMIN, GESTOR, FINANCEIRO | Listar |
| POST | /v1/owners | ADMIN, GESTOR | Criar |
| GET | /v1/owners/:id | ADMIN, GESTOR, FINANCEIRO | Detalhe |
| PATCH | /v1/owners/:id | ADMIN, GESTOR | Atualizar |
| POST | /v1/owners/:id/bank-accounts | ADMIN, GESTOR, FINANCEIRO | Adicionar conta |
| GET | /v1/owners/:id/transfers | FINANCEIRO, GESTOR, Portal(próprio) | Histórico de repasses |
| DELETE | /v1/owners/:id | ADMIN, GESTOR | Inativar (soft) |

```typescript
export const CreateOwnerSchema = z.object({
  personType: z.enum(['PF','PJ']),
  cpfCnpj: z.string().refine(isValidCpfCnpj, 'CPF/CNPJ inválido'),
  fullName: z.string().min(2),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  consent: z.object({ purpose: z.string(), granted: z.literal(true) }),
})
export type CreateOwnerInput = z.infer<typeof CreateOwnerSchema>
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_OWNER_001 | 404 | Não encontrado |
| ERR_OWNER_002 | 422 | Dados inválidos (CPF/PIX) |
| ERR_OWNER_003 | 403 | Papel insuficiente |
| ERR_OWNER_004 | 409 | Proprietário duplicado |
| ERR_OWNER_005 | 409 | Remoção de conta de repasse ativa |

## 6. Máquinas de Estado

### Proprietário — Status

```
ATIVO ──(inativar, sem contrato vigente)──► INATIVO ──(reativar)──► ATIVO
  │
  └─(tentar inativar com contrato vigente)──► BLOQUEADO (409)
```

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| — | ATIVO (criação) | `owner.created` | — | ✓ |
| ATIVO | (conta padrão alterada) | `owner.bank_account_updated` | financeiro (in-app) | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Só uma conta `is_default` por proprietário | Índice parcial único + transação | MOD-FIN |
| RN-02 | Alteração de conta com repasse pendente | Repasse já gerado usa snapshot da conta; novos usam a atualizada | MOD-FIN |
| RN-03 | Inativar proprietário com imóvel/contrato ativo | Bloqueia (`409`) | MOD-IMOVEL, MOD-CONTRATO |
| RN-04 | Consentimento LGPD ausente | Bloqueia comunicações de marketing (transacionais permitidas) | MOD-NOTIF |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `owner.created` | owner | portal, ai-orchestrator | `{ tenantId, ownerId, timestamp }` |
| `owner.bank_account_updated` | owner | financial | `{ tenantId, ownerId, accountId, timestamp }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Financeiro | Corretor | Portal (Proprietário) |
|---|---|---|---|---|---|---|
| Listar | ✓ | ✓ | ✓ | ✓ | — | próprio |
| Criar | ✓ | ✓ | ✓ | — | — | — |
| Editar | ✓ | ✓ | ✓ | conta bancária | — | próprios dados |
| Deletar | ✓ | ✓ | — | — | — | — |

### Audit Log
`owner.created`, `owner.updated`, `owner.bank_account_updated`, `owner.consent_changed` → registro imutável.

### Dados Pessoais (LGPD)

| Campo | Categoria | Base Legal | Retenção | Exportável | Deletável |
|---|---|---|---|---|---|
| cpf_cnpj | Dado pessoal | Execução de contrato | 5 anos pós-contrato | ✓ | anonimização |
| dados bancários | Dado sensível (financeiro) | Execução de contrato | Enquanto houver repasse | ✓ | ✓ |
| consentimento | Metadado LGPD | — | Prova por 5 anos | ✓ | — |

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Conta de repasse padrão | 300s | `owner:bank:{tenantId}:{ownerId}` | `owner.bank_account_updated` |

### Métricas
- `owners_active`: proprietários ativos por tenant.
- `owners_missing_bank_account`: proprietários sem conta de repasse (alerta operacional).

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Validar conta bancária via API do banco/Asaas? | Redução de erro de repasse | Tech Lead | Fase 2 |
| 2 | Envelope encryption com KMS ou chave em secret manager? | Segurança LGPD | Tech Lead/Compliance | Fase 1 |
