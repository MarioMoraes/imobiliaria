# PRD Detalhado — Gestão Documental (Repositório + OCR)

**Módulo:** MOD-DOC
**Arquivo:** 09/20
**Prioridade:** P1
**Fase de Implementação:** 1 (Core de Gestão)
**Serviço Backend:** document-service (`backend/src/modules/document`, monólito porta 3001)
**Tabelas Principais:** documents, document_versions, document_extractions, document_retention_policies
**Data:** 2026-07-10
**Status:** Draft

---

## 1. Visão Geral

**Contexto de negócio.** A imobiliária lida com muitos documentos (RG, CPF, comprovante de renda, matrícula, contratos). Um repositório central com versionamento, controle de expiração e extração de dados por IA reduz erro de cadastro e acelera análises (ex.: pré-preenchimento de ficha a partir do RG). Política de retenção e acesso alinhada à LGPD evita guarda indevida.

**Integração sistêmica.** Vínculo polimórfico com property/owner/customer/contract. Recebe uploads de todos os módulos; publica `document.uploaded` que aciona MOD-AI (OCR/análise). Fornece PDFs gerados pelo MOD-CONTRATO. Consumido pelos portais (MOD-PORTAL). Publica `document.uploaded`, `document.expiring`, `document.extracted`.

**Escopo desta fase.** MVP: upload/download seguro, vínculo polimórfico, versionamento, tipos de documento, controle de validade/expiração, disparo de OCR (a extração em si é MOD-AI), política de retenção. **Fora desta fase:** assinatura digital dentro do repositório, comparação semântica entre versões.

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-DOC-01 | Upload/download seguro | Armazenamento com URL assinada e escopo por tenant | Must Have |
| MOD-DOC-02 | Vínculo polimórfico | Documento associado a property/owner/customer/contract | Must Have |
| MOD-DOC-03 | Versionamento | Nova versão preserva anteriores | Must Have |
| MOD-DOC-04 | Controle de expiração | Data de validade + alerta de expiração | Must Have |
| MOD-DOC-05 | Disparo de OCR | Publica evento para MOD-AI extrair dados | Should Have |
| MOD-DOC-06 | Política de retenção | Expurgo/anonimização automática por tipo | Should Have |

## 3. Critérios de Aceite

### [MOD-DOC-01] — Upload/download seguro

**AC-01 (Happy Path)** — **Dado** um GESTOR, **Quando** `POST /v1/documents` (multipart) vinculando a um `customer`, **Então** armazena, gera `document`, publica `document.uploaded` (201) e retorna URL assinada com expiração curta.
**AC-02 (Validação)** — **Dado** um arquivo acima do limite (ex.: 25MB) ou MIME não permitido, **Quando** envia, **Então** `422` `ERR_DOC_002`.
**AC-03 (Edge Case — isolamento)** — **Dado** documento de `T2`, **Quando** `T1` pede a URL, **Então** `404` `ERR_DOC_001` (URL assinada só emitida no tenant dono).

### [MOD-DOC-04] — Expiração

**AC-01 (Happy Path)** — **Dado** um documento com validade em 30 dias, **Quando** o job diário roda a T-15, **Então** publica `document.expiring` e notifica o responsável.
**AC-02 (Edge Case)** — **Dado** documento vencido vinculado a contrato vigente, **Quando** expira, **Então** marca `EXPIRADO`, alerta, mas **não** bloqueia o contrato (apenas sinaliza pendência).

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| documents | tenant_id, id | String | ✓ | Isolamento / PK |
| documents | entity_type | Enum | ✓ | PROPERTY, OWNER, CUSTOMER, CONTRACT |
| documents | entity_id | String | ✓ | ID da entidade vinculada |
| documents | kind | String | ✓ | RG, CPF, RENDA, MATRICULA, CONTRATO, OUTRO |
| documents | storage_key | String | ✓ | Chave no bucket (privado) |
| documents | mime, size | String/Int | ✓ | Metadados |
| documents | expires_at | Date | — | Validade |
| documents | status | Enum | ✓ | ATIVO, EXPIRADO, EXPURGADO |
| documents | current_version | Int | ✓ | Versão vigente |
| document_versions | document_id, version, storage_key, uploaded_by, uploaded_at | — | ✓ | Imutável |
| document_extractions | document_id, extracted_json, model, confidence, created_at | — | — | Resultado de OCR (MOD-AI) |
| document_retention_policies | tenant_id, kind, retention_days, action | — | — | Retenção/expurgo |

### Campos com Criptografia AES-256-GCM
| Campo | Tabela | Justificativa |
|---|---|---|
| storage_key | documents | Impede enumeração; conteúdo em bucket cifrado |
| extracted_json | document_extractions | Pode conter dado pessoal/sensível extraído |

### Índices
```sql
CREATE INDEX idx_documents_tenant ON documents(tenant_id);
CREATE INDEX idx_documents_entity ON documents(tenant_id, entity_type, entity_id);
CREATE INDEX idx_documents_expires ON documents(tenant_id, expires_at) WHERE status='ATIVO';
CREATE INDEX idx_doc_versions ON document_versions(document_id, version DESC);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/documents | ADMIN, GESTOR, FINANCEIRO, CORRETOR | Listar por entidade |
| POST | /v1/documents | ADMIN, GESTOR, CORRETOR, Portal(próprio) | Upload |
| GET | /v1/documents/:id | idem + Portal(dono) | Metadados + URL assinada |
| POST | /v1/documents/:id/versions | idem | Nova versão |
| GET | /v1/documents/:id/extraction | ADMIN, GESTOR | Dados extraídos (OCR) |
| DELETE | /v1/documents/:id | ADMIN, GESTOR | Expurgar (LGPD) |

```typescript
export const CreateDocumentSchema = z.object({
  entityType: z.enum(['PROPERTY','OWNER','CUSTOMER','CONTRACT']),
  entityId: z.string(),
  kind: z.enum(['RG','CPF','RENDA','MATRICULA','CONTRATO','OUTRO']),
  expiresAt: z.string().date().optional(),
  // arquivo via multipart; MIME/size validados no handler
})
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_DOC_001 | 404 | Não encontrado |
| ERR_DOC_002 | 422 | Arquivo/MIME/tamanho inválido |
| ERR_DOC_003 | 403 | Papel insuficiente |
| ERR_DOC_004 | 409 | Conflito de versão |

## 6. Máquinas de Estado

### Documento — Status

```
ATIVO ──(passou validade)──► EXPIRADO ──(nova versão válida)──► ATIVO
   │
   └──(retenção vencida / pedido LGPD)──► EXPURGADO (conteúdo removido, metadado anonimizado)
```

| De | Para | Evento | Notificações | Audit |
|---|---|---|---|---|
| — | ATIVO | `document.uploaded` | MOD-AI (OCR) | ✓ |
| ATIVO | EXPIRADO | `document.expiring`/`document.expired` | responsável | ✓ |
| * | EXPURGADO | `document.purged` | — | ✓ |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | URL de download sempre assinada e curta (ex.: 5min) | Nunca URL pública permanente | Segurança |
| RN-02 | Expurgo remove binário, mantém metadado anonimizado p/ auditoria | Conformidade LGPD | MOD-SADMIN |
| RN-03 | OCR é assíncrono (MOD-AI); documento utilizável antes da extração | Desacoplamento | MOD-AI |
| RN-04 | Documento expirado não bloqueia contrato, só sinaliza | Não interromper operação | MOD-CONTRATO |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `document.uploaded` | document | ai-orchestrator (OCR) | `{ tenantId, documentId, kind, entityType, timestamp }` |
| `document.extracted` | document (após MOD-AI) | customer/owner (pré-preenche) | `{ tenantId, documentId, extraction }` |
| `document.expiring` | document | notification | `{ tenantId, documentId, expiresAt }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Financeiro | Corretor | Portal(Dono) |
|---|---|---|---|---|---|---|
| Listar | ✓ | ✓ | ✓ | ✓ | ✓ (vinculados) | próprios |
| Upload | ✓ | ✓ | ✓ | ✓ | ✓ | próprios |
| Ver extração | ✓ | ✓ | ✓ | — | — | — |
| Expurgar | ✓ | ✓ | — | — | — | — |

### Audit Log
`document.uploaded/downloaded/purged`, `extraction.viewed` → registra `userId`, `ip` (rastreabilidade de acesso a dado sensível).

### Dados Pessoais (LGPD)

| Campo | Categoria | Base Legal | Retenção | Exportável | Deletável |
|---|---|---|---|---|---|
| documentos pessoais | Dado sensível/pessoal | Consentimento/execução | Por tipo (política) | ✓ | ✓ (expurgo) |
| dados extraídos (OCR) | Dado pessoal | Consentimento | Igual ao doc | ✓ | ✓ |

## 10. Performance & Observabilidade

### Cache Redis
| Dado | TTL | Chave | Invalida |
|---|---|---|---|
| URL assinada | 300s | `doc:url:{tenantId}:{id}` | nova versão |

### Métricas
- `documents_uploaded`: uploads/dia.
- `documents_expiring_7d`: documentos a vencer (alerta operacional).
- `ocr_success_rate`: extrações bem-sucedidas / total.

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Provedor de storage (S3-compat AtlasCloud vs Cloudflare R2) | Custo, latência | Tech Lead | Fase 1 |
| 2 | Limite de tamanho/MIME permitidos configurável por plano? | Billing | PM | Fase 2 |
| 3 | Antivírus/scan no upload? | Segurança | Tech Lead | Fase 1 |
