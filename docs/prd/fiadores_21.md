# PRD Detalhado — Cadastro de Fiadores

**Módulo:** MOD-FIADOR
**Arquivo:** 21/21
**Prioridade:** P1
**Fase de Implementação:** 1 (Core de Gestão)
**Serviço Backend:** guarantor-service (`backend/src/modules/guarantor`, monólito porta 3001)
**Tabelas Principais:** guarantors, guarantor_spouse, guarantor_addresses, guarantor_documents
**Data:** 2026-07-10
**Status:** Draft

> **Origem:** este módulo foi adicionado após a verificação dos cadastros do sistema legado (`imagens/fiadores.jpg`), que possui um "Cadastro de Fiadores" dedicado — inexistente nos PRDs originais. O fiador é a garantia mais comum em locação residencial no Brasil e precisa de ficha própria (análise cadastral, patrimônio, contato) para além de um simples JSON dentro do contrato.

---

## 1. Visão Geral

**Contexto de negócio.** Na locação com garantia por **fiador**, a imobiliária precisa cadastrar e analisar o fiador com a mesma profundidade de um locatário: dados pessoais PF/PJ, cônjuge (fiança exige anuência conjugal), documentos, patrimônio (imóvel dado em garantia) e contato. Sem um cadastro de fiador, não há como validar a garantia, gerar o contrato corretamente nem acionar o fiador em caso de inadimplência.

**Integração sistêmica.** É **parte** de um contrato de locação: `contract-service` (MOD-CONTRATO) referencia o fiador em `contract_parties` (role=FIADOR) e `contract_guarantees` (kind=FIADOR, `guarantor_id`). Reusa o `PersonRecord` compartilhado com [[proprietarios_03]] (owner) e [[clientes_04]] (customer). Publica `guarantor.created`, `guarantor.updated`.

**Escopo desta fase.** MVP: CRUD de fiador (ficha PF/PJ completa: pessoais, cônjuge, endereços residencial/comercial, banco, referências), vínculo a um ou mais contratos, documentos (via MOD-DOC), consentimento LGPD. **Fora desta fase:** análise de crédito automatizada (bureau), avaliação automática do imóvel dado em garantia.

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-FIADOR-01 | CRUD fiador (PF/PJ) | Ficha completa espelhando a tela legada | Must Have |
| MOD-FIADOR-02 | Cônjuge & anuência | Dados do cônjuge (exigidos na fiança) | Must Have |
| MOD-FIADOR-03 | Endereços residencial/comercial | Dois blocos de endereço | Must Have |
| MOD-FIADOR-04 | Vínculo a contratos | Um fiador pode garantir vários contratos | Must Have |
| MOD-FIADOR-05 | Documentos | RG, comprovantes, matrícula do imóvel-garantia (via MOD-DOC) | Should Have |
| MOD-FIADOR-06 | Consentimento LGPD | Consentimento do fiador (dado pessoal de terceiro) | Must Have |

## 3. Critérios de Aceite

### [MOD-FIADOR-01] — CRUD fiador

**AC-01 (Happy Path)** — **Dado** um GESTOR, **Quando** `POST /v1/guarantors` com CPF válido, nome e ≥1 contato, **Então** cria com `status=ATIVO`, publica `guarantor.created` (201).
**AC-02 (Validação)** — **Dado** CPF/CNPJ inválido, **Quando** submete, **Então** `422` `ERR_FIADOR_002` "CPF/CNPJ inválido".
**AC-03 (Edge Case)** — **Dado** CPF já cadastrado como fiador no tenant, **Quando** cria, **Então** `409` `ERR_FIADOR_004` com `existingId` (reaproveita o fiador em novo contrato em vez de duplicar).

### [MOD-FIADOR-02] — Cônjuge & anuência

**AC-01 (Happy Path)** — **Dado** um fiador com `marital_status=CASADO`, **Quando** salva sem dados do cônjuge, **Então** `422` `ERR_FIADOR_002` "Fiança de pessoa casada exige dados e anuência do cônjuge".
**AC-02 (Edge Case)** — **Dado** `marital_status=SOLTEIRO`, **Quando** salva sem cônjuge, **Então** sucesso (cônjuge opcional).

### [MOD-FIADOR-04] — Vínculo a contratos

**AC-01 (Happy Path)** — **Dado** um fiador ativo, **Quando** um contrato de locação o referencia como garantia, **Então** aparece em `contract_guarantees` e o fiador lista o contrato em `GET /v1/guarantors/:id/contracts`.
**AC-02 (Edge Case)** — **Dado** um fiador já vinculado a um contrato **vigente**, **Quando** tenta-se inativá-lo, **Então** `409` `ERR_FIADOR_005` "Fiador com garantia vigente não pode ser inativado".

## 4. Modelo de Dados

> Usa o **`PersonRecord` compartilhado** — mesma estrutura de owner/customer (compat. legado). Tabela dedicada por isolamento de domínio.

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| guarantors | tenant_id, id | String | ✓ | Isolamento / PK |
| guarantors | person_type | Enum | ✓ | PF, PJ |
| guarantors | cpf_cnpj (cript.) | String | ✓ | Único por tenant |
| guarantors | full_name | String | ✓ | Nome/razão social |
| guarantors | rg, rg_issuer (cript.) | String | — | RG + órgão expedidor |
| guarantors | gender, birth_date, marital_status, nationality, occupation | — | — | Dados pessoais |
| guarantors | email, phone, mobile, fax (cript.) | String | — | Contatos |
| guarantors | bank, agency, account, holder_name (cript.) | String | — | Dados bancários |
| guarantors | notes, references | Text | — | Observações e Referências |
| guarantors | status | Enum | ✓ | ATIVO, INATIVO |
| guarantor_spouse | guarantor_id, name, occupation, birth_date, cpf, rg | — | — | Cônjuge (cript. onde aplicável) — anuência da fiança |
| guarantor_addresses | guarantor_id, kind, street, number, district, city, state, zip | — | ✓ | kind: RESIDENCIAL / COMERCIAL |
| guarantor_consents | guarantor_id, purpose, granted, granted_at, ip | — | ✓ | Consentimento LGPD |

### Campos com Criptografia AES-256-GCM

| Campo | Tabela | Justificativa |
|---|---|---|
| cpf_cnpj, rg | guarantors | Dado pessoal identificável (LGPD) |
| email, phone, mobile, fax | guarantors | Dado pessoal |
| bank, agency, account, holder_name | guarantors | Dado financeiro sensível |
| cpf, rg (cônjuge) | guarantor_spouse | Dado pessoal de terceiro |

### Índices

```sql
CREATE INDEX idx_guarantors_tenant ON guarantors(tenant_id);
CREATE UNIQUE INDEX idx_guarantors_tenant_doc ON guarantors(tenant_id, cpf_cnpj);
CREATE INDEX idx_guarantor_addr ON guarantor_addresses(guarantor_id);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/guarantors | ADMIN, GESTOR, CORRETOR | Listar |
| POST | /v1/guarantors | ADMIN, GESTOR, CORRETOR | Criar |
| GET | /v1/guarantors/:id | idem | Detalhe (ficha completa) |
| PATCH | /v1/guarantors/:id | ADMIN, GESTOR | Atualizar |
| GET | /v1/guarantors/:id/contracts | ADMIN, GESTOR | Contratos garantidos |
| DELETE | /v1/guarantors/:id | ADMIN, GESTOR | Inativar (soft) |

```typescript
export const CreateGuarantorSchema = z.object({
  personType: z.enum(['PF', 'PJ']),
  cpfCnpj: z.string().refine(isValidCpfCnpj, 'CPF/CNPJ inválido'),
  fullName: z.string().min(2),
  rg: z.string().optional(),
  rgIssuer: z.string().optional(),
  gender: z.enum(['M', 'F', 'OUTRO']).optional(),
  birthDate: z.string().date().optional(),
  maritalStatus: z.enum(['SOLTEIRO','CASADO','DIVORCIADO','VIUVO','UNIAO_ESTAVEL']).optional(),
  nationality: z.string().default('BRASILEIRA'),
  occupation: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  spouse: z.object({ name: z.string(), cpf: z.string().optional() }).optional(),
  addresses: z.array(z.object({
    kind: z.enum(['RESIDENCIAL', 'COMERCIAL']),
    street: z.string(), number: z.string().optional(), district: z.string().optional(),
    city: z.string(), state: z.string().length(2), zip: z.string().optional(),
  })).min(1),
  consent: z.object({ purpose: z.string(), granted: z.literal(true) }),
}).refine((d) => d.maritalStatus !== 'CASADO' || d.spouse, {
  message: 'Fiança de pessoa casada exige dados do cônjuge',
})
export type CreateGuarantorInput = z.infer<typeof CreateGuarantorSchema>
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_FIADOR_001 | 404 | Não encontrado |
| ERR_FIADOR_002 | 422 | Dados inválidos (CPF/cônjuge) |
| ERR_FIADOR_003 | 403 | Papel insuficiente |
| ERR_FIADOR_004 | 409 | Fiador duplicado (retorna `existingId`) |
| ERR_FIADOR_005 | 409 | Inativação com garantia vigente |

## 6. Máquinas de Estado

### Fiador — Status

```
ATIVO ──(inativar, sem garantia vigente)──► INATIVO ──(reativar)──► ATIVO
  │
  └─(tentar inativar com contrato vigente garantido)──► BLOQUEADO (409)
```

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| — | ATIVO (criação) | `guarantor.created` | — | ✓ |
| ATIVO | INATIVO | `guarantor.deactivated` | — | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Fiança de casado exige cônjuge | Bloqueia salvar sem cônjuge | — |
| RN-02 | Fiador reutilizável em vários contratos | Dedup por CPF/CNPJ; não duplica pessoa | MOD-CONTRATO |
| RN-03 | Não inativar com garantia vigente | Bloqueia (`409`) | MOD-CONTRATO |
| RN-04 | Consentimento LGPD do fiador é obrigatório | Base para tratar dado de terceiro | LGPD |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `guarantor.created` | guarantor | contract, ai-orchestrator | `{ tenantId, guarantorId, timestamp }` |
| `guarantor.updated` | guarantor | contract | `{ tenantId, guarantorId, timestamp }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Financeiro | Corretor |
|---|---|---|---|---|---|
| Listar | ✓ | ✓ | ✓ | ✓ | ✓ (dos próprios contratos) |
| Criar | ✓ | ✓ | ✓ | — | ✓ |
| Editar | ✓ | ✓ | ✓ | — | — |
| Inativar | ✓ | ✓ | — | — | — |

### Audit Log
`guarantor.created`, `guarantor.updated`, `guarantor.deactivated`, `guarantor.consent_changed` → registro imutável.

### Dados Pessoais (LGPD)

| Campo | Categoria | Base Legal | Retenção | Exportável | Deletável |
|---|---|---|---|---|---|
| cpf_cnpj, rg | Dado pessoal | Execução de contrato | Vigência da fiança + 5 anos | ✓ | anonimização |
| dados bancários | Dado sensível | Execução de contrato | Igual acima | ✓ | ✓ |
| cônjuge | Dado de terceiro | Consentimento | Igual acima | ✓ | ✓ |

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| Ficha do fiador | 300s | `guarantor:{tenantId}:{id}` | `guarantor.updated` |

### Métricas
- `guarantors_active`: fiadores ativos por tenant.
- `contracts_with_fiador`: % de contratos de locação garantidos por fiador (vs caução/seguro).

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Análise de crédito do fiador (bureau) em qual fase? | Risco de locação | PM | Fase 2 |
| 2 | Registrar o imóvel dado em garantia como entidade? | Patrimônio do fiador | PM/Tech Lead | Fase 2 |
| 3 | Um contrato pode ter múltiplos fiadores? (padrão: sim) | Modelagem | PM | Fase 1 |
