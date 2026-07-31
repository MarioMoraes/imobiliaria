-- ═════════════════════════════════════════════════════════════════
-- Migração para instalações que subiram ANTES de 2026-07-28 (ef0ab34).
--
-- `init.sql` só roda na criação do volume do Postgres: um banco que já existe
-- nunca vê as tabelas novas. Este arquivo é o delta de init.sql desde aquele
-- ponto — vistoria, repasse ao proprietário, repositório documental e trilha
-- de auditoria.
--
-- É IDEMPOTENTE: rodar duas vezes não quebra nada.
--
-- Rodar como SUPERUSUÁRIO (`-U imobiliaria`), não como app_user: só o dono do
-- banco cria tabela e concede GRANT.
--
--   docker exec -i <container-postgres> \
--     psql -U imobiliaria -d imobiliaria -v ON_ERROR_STOP=1 \
--     < infra/postgres/migrations/2026-07-31-vistoria-repasse-documentos-auditoria.sql
-- ═════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Vistoria do imóvel (uma por imóvel) + linhas do checklist.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_inspections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  seq         INT,                -- "Número" da tela legada; sequencial por tenant
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_inspections_property   ON property_inspections (property_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_inspections_tenant_seq ON property_inspections (tenant_id, seq);

ALTER TABLE property_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_inspections FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON property_inspections;
CREATE POLICY tenant_isolation ON property_inspections
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON property_inspections TO app_user;

CREATE TABLE IF NOT EXISTS property_inspection_entries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inspection_id      UUID NOT NULL REFERENCES property_inspections(id) ON DELETE CASCADE,
  inspection_item_id UUID,             -- FK lógica → inspection_items (o item pode ser excluído)
  description        TEXT NOT NULL,    -- snapshot: a linha sobrevive à exclusão do item
  position           INT  NOT NULL DEFAULT 0,   -- coluna "Cód" / ordem de exibição
  quantity           INT  NOT NULL DEFAULT 0,   -- coluna "Qtde"
  condition          TEXT,             -- 'BOM' | 'MEDIO' | 'RUIM' | NULL
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inspection_entries_inspection ON property_inspection_entries (inspection_id, position);
-- Torna idempotente o "sincroniza o catálogo na abertura" (ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspection_entries_item ON property_inspection_entries (inspection_id, inspection_item_id);

ALTER TABLE property_inspection_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_inspection_entries FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON property_inspection_entries;
CREATE POLICY tenant_isolation ON property_inspection_entries
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON property_inspection_entries TO app_user;

-- ═════════════════════════════════════════════════════════════════
-- MOD-FIN / Repasse ao proprietário — contas a pagar.
-- ═════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payables (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id        UUID REFERENCES contracts(id) ON DELETE CASCADE,
  property_id        UUID,                            -- FK lógica → properties
  receivable_id      UUID,                            -- FK lógica → receivables (origem)
  payee_person_id    UUID NOT NULL,                   -- FK lógica → persons (proprietário)
  kind               TEXT NOT NULL DEFAULT 'REPASSE', -- REPASSE|OUTRO
  description        TEXT,
  competence         TEXT,                            -- YYYY-MM do aluguel de origem
  share_percent      NUMERIC(5,2) NOT NULL DEFAULT 100,
  gross_cents        BIGINT NOT NULL,
  admin_fee_percent  NUMERIC(5,2) NOT NULL DEFAULT 0, -- snapshot do contrato/imóvel
  admin_fee_cents    BIGINT NOT NULL DEFAULT 0,       -- receita da imobiliária
  amount_cents       BIGINT NOT NULL,                 -- líquido = gross - admin_fee
  due_date           DATE NOT NULL,
  status             TEXT NOT NULL DEFAULT 'ABERTO',  -- ABERTO|PAGO|VENCIDO|CANCELADO|ESTORNADO
  paid_at            DATE,
  paid_amount_cents  BIGINT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payables_tenant_status ON payables (tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_payables_payee         ON payables (tenant_id, payee_person_id, status);
CREATE INDEX IF NOT EXISTS idx_payables_contract      ON payables (contract_id, due_date);
-- Idempotência do repasse: reprocessar a baixa não pode pagar o dono em dobro.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payables_source
  ON payables (receivable_id, payee_person_id)
  WHERE receivable_id IS NOT NULL;

ALTER TABLE payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE payables FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payables;
CREATE POLICY tenant_isolation ON payables
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON payables TO app_user;

-- ── Chave PIX do proprietário (repasse via Asaas) ────────────────
-- `pix_key_type` usa a nomenclatura do Asaas (CPF|CNPJ|EMAIL|PHONE|EVP).
ALTER TABLE persons ADD COLUMN IF NOT EXISTS pix_key      TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS pix_key_type TEXT;

-- ── Transferência do repasse (Asaas), assíncrona ─────────────────
ALTER TABLE payables ADD COLUMN IF NOT EXISTS asaas_transfer_id      TEXT;
ALTER TABLE payables ADD COLUMN IF NOT EXISTS transfer_status        TEXT;
ALTER TABLE payables ADD COLUMN IF NOT EXISTS transfer_failed_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_payables_transfer ON payables (asaas_transfer_id)
  WHERE asaas_transfer_id IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════
-- MOD-DOC — repositório documental (vínculo polimórfico + versionamento).
-- ═════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL
                    CHECK (entity_type IN ('PROPERTY','PERSON','CONTRACT')),
  entity_id       UUID NOT NULL,                  -- FK lógica (polimórfica)
  kind            TEXT NOT NULL DEFAULT 'OUTRO'
                    CHECK (kind IN ('RG','CPF','RENDA','MATRICULA','CONTRATO','OUTRO')),
  file_name       TEXT,                           -- nulo depois do expurgo
  mime            TEXT,
  size_bytes      BIGINT,
  expires_at      DATE,
  status          TEXT NOT NULL DEFAULT 'ATIVO'
                    CHECK (status IN ('ATIVO','EXPURGADO')),
  current_version INT  NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_tenant  ON documents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_entity  ON documents (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_expires ON documents (tenant_id, expires_at)
  WHERE status = 'ATIVO' AND expires_at IS NOT NULL;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documents;
CREATE POLICY tenant_isolation ON documents
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO app_user;

-- Versões (append-only): substituir um documento nunca apaga o anterior.
CREATE TABLE IF NOT EXISTS document_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version     INT  NOT NULL,
  storage_key TEXT,                               -- nulo depois do expurgo
  mime        TEXT,
  size_bytes  BIGINT,
  uploaded_by UUID,                               -- FK lógica → users
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_versions_uniq ON document_versions (document_id, version);
CREATE INDEX        IF NOT EXISTS idx_doc_versions      ON document_versions (document_id, version DESC);

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document_versions;
CREATE POLICY tenant_isolation ON document_versions
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON document_versions TO app_user;

-- ═════════════════════════════════════════════════════════════════
-- MOD-AUTH-07 — Trilha de auditoria (SPEC 9.4). Imutável por privilégio:
-- app_user recebe SELECT/INSERT/DELETE e NENHUM UPDATE.
-- ═════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,  -- nulo p/ ator não-humano
  actor_label TEXT,
  action      TEXT NOT NULL,                      -- entidade.acao (ex.: contract.signed)
  entity      TEXT NOT NULL,
  entity_id   TEXT,                               -- id do alvo (texto: nem todo alvo é uuid)
  payload     JSONB,                              -- corpo REDIGIDO (ver audit.redact.ts)
  ip_address  INET,
  request_id  TEXT,
  status      TEXT NOT NULL DEFAULT 'OK'
                CHECK (status IN ('OK','DENIED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_action  ON audit_logs (tenant_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity         ON audit_logs (tenant_id, entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created        ON audit_logs (created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_select ON audit_logs;
CREATE POLICY audit_select ON audit_logs FOR SELECT
  USING (
    current_setting('app.platform', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

DROP POLICY IF EXISTS audit_insert ON audit_logs;
CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (
    current_setting('app.platform', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- Única remoção permitida: expurgo de retenção (LGPD, 12 meses).
DROP POLICY IF EXISTS audit_purge ON audit_logs;
CREATE POLICY audit_purge ON audit_logs FOR DELETE
  USING (
    current_setting('app.platform', true) = 'on'
    AND created_at < now() - interval '12 months'
  );

-- Sem UPDATE: nem no GRANT, nem em policy. A trilha só cresce.
REVOKE UPDATE ON audit_logs FROM app_user;
GRANT SELECT, INSERT, DELETE ON audit_logs TO app_user;

COMMIT;
