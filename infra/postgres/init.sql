-- ─────────────────────────────────────────────────────────────
-- Bootstrap do banco multi-tenant.
--
-- Estratégia (ver SPEC seção 3.1): shared database, shared schema,
-- isolamento por linha com tenant_id + Row-Level Security (RLS).
--
-- IMPORTANTE: RLS é IGNORADO por superusuários. A aplicação NUNCA deve
-- conectar como o superusuário do Postgres. Criamos aqui o papel
-- `app_user` (não-superusuário), e é com ele que o backend conecta.
-- Assim as policies de RLS são efetivamente aplicadas.
--
-- Este script roda uma única vez, na primeira criação do volume.
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";   -- embeddings do RAG (MOD-AI)

-- Papel da aplicação (não-superusuário → RLS é aplicado).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;

-- ── Registro de tenants (nível plataforma) ───────────────────────
-- É a única tabela cuja policy não é "tenant_id = app.tenant_id": aqui a linha
-- É o tenant. A policy (definida logo abaixo da tabela) aceita duas condições:
--   • id = app.tenant_id   → a imobiliária lê/edita o próprio cadastro;
--   • app.platform = 'on'  → operação de plataforma (Super Admin, unicidade
--                            global no onboarding), via withPlatform() no código.
-- Sem isso, qualquer consulta a `tenants` alcançaria o registro de todos os
-- clientes, e um bug em qualquer caminho /v1 vazaria a base de clientes inteira.
CREATE TABLE IF NOT EXISTS tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,        -- subdomínio: <slug>.officestecnologia.com.br
  cnpj         TEXT UNIQUE,                 -- CNPJ da imobiliária (único global). TODO: cifrar em repouso (AES-256-GCM, PRD §4/9)
  creci        TEXT,                        -- registro CRECI da imobiliária
  clerk_org_id TEXT UNIQUE,                 -- Organização Clerk correspondente (org = tenant); nulo no dev-mode
  domain       TEXT UNIQUE,                 -- domínio próprio (opcional)
  logo_url     TEXT,                        -- logo/ícone da imobiliária (data URL na Fase 0)
  plan         TEXT NOT NULL DEFAULT 'free',
  -- status: trial | active | suspended | inactive | canceled (validado no Zod; sem CHECK rígido)
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NULLIF(..., '') é obrigatório aqui: uma vez que `app.tenant_id` tenha sido
-- definido na SESSÃO (é o que todo withTenant faz), ao fim da transação o valor
-- local reverte para string VAZIA — não para NULL. Sem o NULLIF, ''::uuid lança
-- "invalid input syntax for type uuid" e a consulta de plataforma quebra numa
-- conexão reciclada do pool, em vez de simplesmente não casar.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE  ROW LEVEL SECURITY; -- aplica também ao owner da tabela
DROP POLICY IF EXISTS tenant_self_or_platform ON tenants;
CREATE POLICY tenant_self_or_platform ON tenants
  USING       (
    current_setting('app.platform', true) = 'on'
    OR id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK  (
    current_setting('app.platform', true) = 'on'
    OR id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- ── Usuários & papéis (MOD-AUTH) — tabelas de domínio, protegidas por RLS ──
-- Fase 0: o usuário é criado sem credencial local; login/JWT vêm via Clerk
-- (MOD-AUTH-05). clerk_external_id vincula o usuário à identidade do Clerk depois.
-- TODO: cifrar email em repouso (AES-256-GCM, PRD §4/9).
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  clerk_external_id TEXT,                          -- vínculo com Clerk (nulo na Fase 0)
  email             TEXT NOT NULL,
  full_name         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active', -- invited | active | disabled
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email ON users (tenant_id, lower(email));

CREATE TABLE IF NOT EXISTS user_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SUPER_ADMIN | ADMIN | GESTOR | CORRETOR | FINANCEIRO | AUXILIAR
  --             | PROPRIETARIO | CLIENTE | AI_AGENT
  role        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_user_role ON user_roles (user_id, role);

ALTER TABLE users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users      FORCE  ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON user_roles
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON users      TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles TO app_user;

-- ── Imóveis (tabela de domínio, protegida por RLS) ───────────────
CREATE TABLE IF NOT EXISTS properties (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'sale',        -- (legado) sale | rent | season ...
  purpose       TEXT NOT NULL DEFAULT 'sale',        -- finalidade: sale | rent | season
  property_type_id UUID,                             -- tipo do imóvel (FK lógica → property_types)
  is_development   BOOLEAN NOT NULL DEFAULT false,   -- empreendimento-pai
  status        TEXT NOT NULL DEFAULT 'available',   -- available | reserved | rented | sold | inactive
  price_cents   BIGINT,
  city          TEXT,
  state         TEXT,
  bedrooms      INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_properties_tenant ON properties (tenant_id);

-- ── Cadastro completo "Imóveis a Alugar" (tela legada) ───────────
-- Campos aditivos ao núcleo acima. ADD COLUMN IF NOT EXISTS mantém a
-- compatibilidade com volumes/seed já existentes e é idempotente.
-- Identificação
ALTER TABLE properties ADD COLUMN IF NOT EXISTS code               INT;              -- Código sequencial por tenant
ALTER TABLE properties ADD COLUMN IF NOT EXISTS contract_number    TEXT;             -- Contrato
ALTER TABLE properties ADD COLUMN IF NOT EXISTS condominium_id     UUID;             -- FK lógica → condominiums
ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_commercial      BOOLEAN NOT NULL DEFAULT false; -- Comércio
-- Endereço
ALTER TABLE properties ADD COLUMN IF NOT EXISTS street_type        TEXT;             -- Logradouro (Rua/Alameda/Av.)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS address            TEXT;             -- Endereço (logradouro, via CEP)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS number             TEXT;             -- Número
ALTER TABLE properties ADD COLUMN IF NOT EXISTS district           TEXT;             -- Bairro
ALTER TABLE properties ADD COLUMN IF NOT EXISTS zip                TEXT;             -- CEP
ALTER TABLE properties ADD COLUMN IF NOT EXISTS keys_location      TEXT;             -- Chaves
ALTER TABLE properties ADD COLUMN IF NOT EXISTS has_sign           BOOLEAN NOT NULL DEFAULT false; -- Placa
ALTER TABLE properties ADD COLUMN IF NOT EXISTS position_front     BOOLEAN NOT NULL DEFAULT false; -- Frente
ALTER TABLE properties ADD COLUMN IF NOT EXISTS position_back      BOOLEAN NOT NULL DEFAULT false; -- Fundos
-- Características
ALTER TABLE properties ADD COLUMN IF NOT EXISTS built_area         NUMERIC(10,2);    -- Área Construída
ALTER TABLE properties ADD COLUMN IF NOT EXISTS land_area          NUMERIC(10,2);    -- Área Terreno
ALTER TABLE properties ADD COLUMN IF NOT EXISTS floor_info         TEXT;             -- Piso
ALTER TABLE properties ADD COLUMN IF NOT EXISTS ceiling_info       TEXT;             -- Teto
ALTER TABLE properties ADD COLUMN IF NOT EXISTS electricity_meter  TEXT;             -- Luz
ALTER TABLE properties ADD COLUMN IF NOT EXISTS water_meter        TEXT;             -- Água
ALTER TABLE properties ADD COLUMN IF NOT EXISTS dependencies       TEXT;             -- Depend
ALTER TABLE properties ADD COLUMN IF NOT EXISTS allow_pets         BOOLEAN NOT NULL DEFAULT false; -- Animais
ALTER TABLE properties ADD COLUMN IF NOT EXISTS allow_students     BOOLEAN NOT NULL DEFAULT false; -- Estudantes
-- Valores / encargos
ALTER TABLE properties ADD COLUMN IF NOT EXISTS condo_fee_cents      BIGINT;         -- VL Cond
ALTER TABLE properties ADD COLUMN IF NOT EXISTS iptu_cents           BIGINT;         -- IPTU
ALTER TABLE properties ADD COLUMN IF NOT EXISTS iptu_charged_to      TEXT;           -- Descontar IPTU de (LOCATARIO|LOCADOR)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS iptu_reimburse_owner BOOLEAN NOT NULL DEFAULT false; -- Ressarcir Locador (IPTU)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS iptu_installments    INT;            -- Nº Parcelas
ALTER TABLE properties ADD COLUMN IF NOT EXISTS iptu_installment_cents BIGINT;       -- Valor Parcelas
ALTER TABLE properties ADD COLUMN IF NOT EXISTS admin_fee_percent    NUMERIC(5,2);   -- Tx Adm %
ALTER TABLE properties ADD COLUMN IF NOT EXISTS charge_admin_fee     BOOLEAN NOT NULL DEFAULT false; -- Tx Adm
ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_guaranteed        BOOLEAN NOT NULL DEFAULT false; -- Garantido
-- Locação / comissão
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lease_term_months   INT;             -- Prazo Contrato de Locação
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lease_start         DATE;            -- Início
ALTER TABLE properties ADD COLUMN IF NOT EXISTS penalty_info        TEXT;            -- Multa
ALTER TABLE properties ADD COLUMN IF NOT EXISTS has_commission      BOOLEAN NOT NULL DEFAULT false; -- Comissão
ALTER TABLE properties ADD COLUMN IF NOT EXISTS commission_type     TEXT;            -- (ex.: "1º Mês de Aluguel")
ALTER TABLE properties ADD COLUMN IF NOT EXISTS entry_date          DATE;            -- Entrada
-- Captação / publicação / observações
ALTER TABLE properties ADD COLUMN IF NOT EXISTS broker_id           UUID;            -- Corretor (FK lógica → employees)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS capturer_id         UUID;            -- Captador (FK lógica → employees)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS extra_data          TEXT;            -- Dados
ALTER TABLE properties ADD COLUMN IF NOT EXISTS publish_web         BOOLEAN NOT NULL DEFAULT false; -- Publicar / Internet
ALTER TABLE properties ADD COLUMN IF NOT EXISTS has_photos          BOOLEAN NOT NULL DEFAULT false; -- Com Foto
ALTER TABLE properties ADD COLUMN IF NOT EXISTS notes               TEXT;            -- Obs
-- Venda: autorização de venda (tela legada "Imóveis a Vender")
ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_authorized       BOOLEAN NOT NULL DEFAULT false; -- Autoriz
ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_exclusive        BOOLEAN NOT NULL DEFAULT false; -- Exclusivo
ALTER TABLE properties ADD COLUMN IF NOT EXISTS auth_term           TEXT;            -- Tempo (ex.: "Tempo Indeterminado")
ALTER TABLE properties ADD COLUMN IF NOT EXISTS auth_days           INT;             -- Dias
ALTER TABLE properties ADD COLUMN IF NOT EXISTS auth_expiry         DATE;            -- Vencto (da autorização)
-- Venda: documentação
ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_recorded         BOOLEAN NOT NULL DEFAULT false; -- Averbada
ALTER TABLE properties ADD COLUMN IF NOT EXISTS has_deed            BOOLEAN NOT NULL DEFAULT false; -- Escritura
ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_registered       BOOLEAN NOT NULL DEFAULT false; -- Registrada
ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_sold             BOOLEAN NOT NULL DEFAULT false; -- Vendido
ALTER TABLE properties ADD COLUMN IF NOT EXISTS registry_office     TEXT;            -- Cartório de Registro
ALTER TABLE properties ADD COLUMN IF NOT EXISTS registration_number TEXT;            -- Matrícula
-- Venda: medidas do terreno (texto livre — aceitam "12,5m" etc.)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS topography          TEXT;            -- Topografia
ALTER TABLE properties ADD COLUMN IF NOT EXISTS lot_number          TEXT;            -- Lote
ALTER TABLE properties ADD COLUMN IF NOT EXISTS block_number        TEXT;            -- Quadra
ALTER TABLE properties ADD COLUMN IF NOT EXISTS front_measure       TEXT;            -- Frente (medida)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS back_measure        TEXT;            -- Fundos (medida)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS left_measure        TEXT;            -- Esquerda (medida)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS right_measure       TEXT;            -- Direita (medida)

-- Código sequencial por tenant (referência humana, como a tela legada).
CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_tenant_code ON properties (tenant_id, code);

-- ── RLS: isola linhas por tenant ─────────────────────────────────
-- A aplicação define o tenant corrente por transação com:
--   SELECT set_config('app.tenant_id', '<uuid>', true);
-- A policy compara tenant_id com esse valor. Sem valor definido,
-- current_setting(..., true) retorna NULL → nenhuma linha é visível (deny by default).
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties FORCE  ROW LEVEL SECURITY; -- aplica também ao owner da tabela

CREATE POLICY tenant_isolation ON properties
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Privilégios do app_user.
-- tenants tem policy própria (self OR platform) — ver a definição da tabela.
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants    TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON properties TO app_user;

-- ── Seed de demonstração ─────────────────────────────────────────
-- logo_url: SVG (mark da marca) embutido como data URL — demonstra o logo do
-- tenant na sidebar sem depender de object storage na Fase 0.
INSERT INTO tenants (id, name, slug, cnpj, plan, logo_url)
VALUES ('00000000-0000-0000-0000-000000000001', 'Imobiliária Demo', 'demo', '00000000000191', 'pro',
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM3YzNhZWQiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyNTYzZWIiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNiIgZmlsbD0idXJsKCNnKSIvPjxwYXRoIGQ9Ik0xOSAzMyBMMzIgMjEgTDQ1IDMzIiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMy40IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48cGF0aCBkPSJNMjIgMzEgVjQ1IGExIDEgMCAwIDAgMSAxIEg0MSBhMSAxIDAgMCAwIDEtMSBWMzEiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIzLjQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjxwYXRoIGQ9Ik0yOCA0NiBWMzcgaDggdjkiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIzLjQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L3N2Zz4=')
ON CONFLICT (id) DO NOTHING;

INSERT INTO properties (tenant_id, title, kind, purpose, status, price_cents, city, state, bedrooms)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Apartamento 2 quartos no Centro', 'rent', 'rent', 'available', 250000, 'São Paulo', 'SP', 2),
  ('00000000-0000-0000-0000-000000000001', 'Casa com quintal na Zona Sul',    'sale', 'sale', 'available', 85000000, 'São Paulo', 'SP', 3)
ON CONFLICT DO NOTHING;

-- Usuário admin demo do tenant demo (id fixo p/ testes/idempotência).
INSERT INTO users (id, tenant_id, email, full_name, status)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001',
        'admin@demo.officesai.com.br', 'Admin Demo', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (tenant_id, user_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'ADMIN')
ON CONFLICT (user_id, role) DO NOTHING;

-- Usuário do login Clerk de desenvolvimento (moraes.mario@gmail.com). Mantém o
-- acesso ADMIN ao tenant demo sobrevivendo ao `infra:reset` — o claim tenant_id
-- do token aponta para o tenant demo (ver memória auth-clerk-setup / RBAC).
INSERT INTO users (id, tenant_id, clerk_external_id, email, full_name, status)
VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001',
        'user_3GMSRF0wiuH0liQQywUs2fR1HUb', 'moraes.mario@gmail.com', 'Mario Moraes', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (tenant_id, user_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'ADMIN')
ON CONFLICT (user_id, role) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- Tipo de Imóvel (lookup editável por tenant) — compat. tela legada
-- "Cadastro de Tipo de Imóveis". Distinto da FINALIDADE (venda/locação).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_property_types_tenant ON property_types (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_types_tenant_name ON property_types (tenant_id, lower(name));

ALTER TABLE property_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_types FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON property_types
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON property_types TO app_user;

INSERT INTO property_types (tenant_id, name)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Apartamento'),
  ('00000000-0000-0000-0000-000000000001', 'Casa'),
  ('00000000-0000-0000-0000-000000000001', 'Sala Comercial'),
  ('00000000-0000-0000-0000-000000000001', 'Terreno'),
  ('00000000-0000-0000-0000-000000000001', 'Galpão')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- Cláusulas contratuais (lookup editável por tenant) — compat. tela
-- legada "Cadastro de Cláusulas". Reaproveitadas na montagem de contratos.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clauses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clauses_tenant ON clauses (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clauses_tenant_name ON clauses (tenant_id, lower(name));

ALTER TABLE clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE clauses FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clauses
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON clauses TO app_user;

INSERT INTO clauses (tenant_id, name, description)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Cláusula de 1 ano',
   'Fica convencionado que, se o Locatário desocupar o Imóvel na data em que o Contrato completar 1 ano, o mesmo ficará isento da multa contratual.')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- Itens de Vistoria (lookup editável por tenant) — compat. tela legada
-- "Cadastro de Itens de Vistoria". Itens conferidos na vistoria do imóvel.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inspection_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inspection_items_tenant ON inspection_items (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspection_items_tenant_desc ON inspection_items (tenant_id, lower(description));

ALTER TABLE inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_items FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inspection_items
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_items TO app_user;

INSERT INTO inspection_items (tenant_id, description)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Pintura externa'),
  ('00000000-0000-0000-0000-000000000001', 'Pintura interna'),
  ('00000000-0000-0000-0000-000000000001', 'Instalações elétricas'),
  ('00000000-0000-0000-0000-000000000001', 'Instalações hidráulicas'),
  ('00000000-0000-0000-0000-000000000001', 'Pisos e azulejos')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- Vistoria do imóvel — compat. tela legada "Cadastro de Vistoria".
-- Cabeçalho (uma por imóvel) + linhas do checklist, materializadas a partir
-- do catálogo `inspection_items` do tenant.
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
-- Uma vistoria por imóvel (decisão de produto): o índice é quem garante.
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_inspections_property ON property_inspections (property_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_inspections_tenant_seq ON property_inspections (tenant_id, seq);

ALTER TABLE property_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_inspections FORCE  ROW LEVEL SECURITY;
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
  condition          TEXT,             -- 'BOM' | 'MEDIO' | 'RUIM' | NULL (Bom/Médio/Ruim)
  notes              TEXT,             -- coluna "Observações"
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inspection_entries_inspection ON property_inspection_entries (inspection_id, position);
-- Torna idempotente o "sincroniza o catálogo na abertura" (ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspection_entries_item ON property_inspection_entries (inspection_id, inspection_item_id);

ALTER TABLE property_inspection_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_inspection_entries FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON property_inspection_entries
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON property_inspection_entries TO app_user;

-- ─────────────────────────────────────────────────────────────
-- Bairros (lookup) — nome do bairro reaproveitado nos endereços. Tela
-- "Tabelas". Tabela de domínio, protegida por RLS.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS districts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_districts_tenant ON districts (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_districts_tenant_name ON districts (tenant_id, lower(name));

ALTER TABLE districts ENABLE ROW LEVEL SECURITY;
ALTER TABLE districts FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON districts
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON districts TO app_user;

INSERT INTO districts (tenant_id, name)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Centro'),
  ('00000000-0000-0000-0000-000000000001', 'Jardins'),
  ('00000000-0000-0000-0000-000000000001', 'Zona Sul')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- Eventos financeiros (lookup) — tela "Tabelas". Tipo (débito/crédito) +
-- encargos por atraso (juros, juros de execução judicial, multa) e se incide
-- a taxa de administração. Usados na composição de débitos/créditos da
-- cobrança. Tabela de domínio, protegida por RLS.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  kind                      TEXT NOT NULL DEFAULT 'DEBITO',   -- DEBITO | CREDITO
  interest_percent          NUMERIC(6,3) NOT NULL DEFAULT 0,  -- Juros %
  judicial_interest_percent NUMERIC(6,3) NOT NULL DEFAULT 0,  -- Juros Exec Judicial %
  penalty_percent           NUMERIC(6,3) NOT NULL DEFAULT 0,  -- Multa %
  applies_admin_fee         BOOLEAN NOT NULL DEFAULT false,   -- Incide Taxa de Administração
  active                    BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_tenant ON events (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_tenant_name ON events (tenant_id, lower(name));

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON events
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON events TO app_user;

INSERT INTO events (tenant_id, name, kind, interest_percent, judicial_interest_percent, penalty_percent, applies_admin_fee)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'ÁGUA',       'DEBITO', 0.000, 1.000, 0.000, false),
  ('00000000-0000-0000-0000-000000000001', 'CONDOMÍNIO', 'DEBITO', 1.000, 1.000, 2.000, true)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- Bancos (MOD-FIN) — contas bancárias da imobiliária (tela legada "Bancos").
-- Identificação (código, nome, agência, conta) + favorito. Os saldos (Saldo,
-- Cofre, Em Trânsito) são DERIVADOS da movimentação financeira (lançamentos/
-- boletos — rotinas futuras); nascem em 0 e são somente-leitura na tela. O
-- "Provável Saldo" NÃO é coluna: é calculado (Saldo + Em Trânsito). Tabela de
-- domínio, protegida por RLS.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS banks (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                   INTEGER NOT NULL DEFAULT 0,      -- Código
  name                   TEXT NOT NULL,                   -- Nome
  agency                 TEXT,                            -- Agência
  account_number         TEXT,                            -- Conta nº
  favorite               BOOLEAN NOT NULL DEFAULT false,  -- Favorito
  balance_cents          BIGINT NOT NULL DEFAULT 0,       -- Saldo (derivado)
  vault_cents            BIGINT NOT NULL DEFAULT 0,       -- Cofre (derivado)
  in_transit_cents       BIGINT NOT NULL DEFAULT 0,       -- Em Trânsito (derivado)
  active                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_banks_tenant ON banks (tenant_id);
-- Código sequencial por tenant: o único garante que a corrida do MAX(code)+1
-- falhe em vez de gerar dois bancos com o mesmo código (ver lockSequence).
CREATE UNIQUE INDEX IF NOT EXISTS idx_banks_tenant_code ON banks (tenant_id, code);

ALTER TABLE banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE banks FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON banks
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON banks TO app_user;

-- ─────────────────────────────────────────────────────────────
-- Corretores (MOD-CORRETOR) — cadastro simples de corretores parceiros (tela
-- legada "Cadastro de Corretores"): identificação (nome + documentos), contato
-- (telefone/celular), endereço e o percentual de comissão. `code` é sequencial
-- por tenant. Tabela de domínio, protegida por RLS.
CREATE TABLE IF NOT EXISTS brokers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code               INTEGER NOT NULL DEFAULT 0,      -- Código (sequencial por tenant)
  name               TEXT NOT NULL,                   -- Nome
  address            TEXT,                            -- Endereço
  district           TEXT,                            -- Bairro
  city               TEXT,                            -- Cidade
  state              TEXT,                            -- UF
  zip                TEXT,                            -- CEP
  phone              TEXT,                            -- Telefone
  mobile             TEXT,                            -- Celular
  cpf                TEXT,                            -- CPF
  rg                 TEXT,                            -- RG
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0, -- Comissão %
  active             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brokers_tenant ON brokers (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_brokers_tenant_code ON brokers (tenant_id, code);

ALTER TABLE brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE brokers FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brokers
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON brokers TO app_user;

-- ─────────────────────────────────────────────────────────────
-- Condomínios (MOD-CONDOMINIO) — condomínios administrados pela imobiliária:
-- identificação (nome + endereço) e parâmetros financeiros de cobrança (taxa
-- de administração em % e/ou valor fixo, juros e multa por atraso). O `saldo`
-- (balance_cents) é DERIVADO da movimentação financeira (débitos/despesas/
-- boletos — módulos futuros); nasce em 0. Tabela de domínio, protegida por RLS.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS condominiums (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  address               TEXT,                             -- logradouro (via CEP)
  number                TEXT,                             -- número (único campo livre)
  district              TEXT,
  zip                   TEXT,
  city                  TEXT,
  state                 TEXT,                             -- UF (via CEP)
  -- Saldo: DERIVADO na leitura (recebido nas cobranças PAGAS menos as despesas
  -- lançadas) — ver `withBalances` em condominium.service.ts. Esta coluna nunca
  -- chegou a ser escrita e é ignorada na leitura; fica só para não exigir
  -- migração destrutiva nos bancos já criados.
  balance_cents         BIGINT NOT NULL DEFAULT 0,
  admin_fee_percent     NUMERIC(5,2) NOT NULL DEFAULT 0,  -- Taxa Adm %
  admin_fee_fixed_cents BIGINT NOT NULL DEFAULT 0,        -- Taxa Adm R$ (fixa)
  interest_percent      NUMERIC(5,2) NOT NULL DEFAULT 0,  -- Juros
  penalty_percent       NUMERIC(5,2) NOT NULL DEFAULT 0,  -- Multa
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_condominiums_tenant ON condominiums (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_condominiums_tenant_name ON condominiums (tenant_id, lower(name));

ALTER TABLE condominiums ENABLE ROW LEVEL SECURITY;
ALTER TABLE condominiums FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON condominiums
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON condominiums TO app_user;

INSERT INTO condominiums (tenant_id, name, address, district, zip, city, admin_fee_percent, interest_percent, penalty_percent)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Edifício Aurora',   'Rua das Palmeiras, 100', 'Centro',   '01310-100', 'São Paulo', 10.00, 1.00, 2.00),
  ('00000000-0000-0000-0000-000000000001', 'Residencial Bosque', 'Av. Brasil, 2500',       'Jardins',  '01430-000', 'São Paulo',  8.00, 1.00, 2.00)
ON CONFLICT DO NOTHING;

-- Despesas do condomínio (tela legada "Cadastro de Despesas"). Lançamentos de
-- débito/crédito por condomínio. `seq` é o "Lancto nº" — sequencial por tenant.
-- `event_id` é FK lógica → events (o Evento classifica a despesa).
CREATE TABLE IF NOT EXISTS condominium_expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  condominium_id  UUID NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
  seq             INT,                              -- Lancto nº (sequencial por tenant)
  entry_date      DATE,                             -- Data
  event_id        UUID,                             -- Evento (FK lógica → events)
  amount_cents    BIGINT NOT NULL DEFAULT 0,        -- Valor
  notes           TEXT,                             -- Histórico
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_condo_expenses_tenant ON condominium_expenses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_condo_expenses_condo  ON condominium_expenses (condominium_id);
-- "Lancto nº" é sequencial por TENANT (não por condomínio), como o MAX(seq)+1.
CREATE UNIQUE INDEX IF NOT EXISTS idx_condo_expenses_tenant_seq
  ON condominium_expenses (tenant_id, seq);

ALTER TABLE condominium_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE condominium_expenses FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON condominium_expenses
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON condominium_expenses TO app_user;

-- ─────────────────────────────────────────────────────────────
-- (Fiadores) — os antigos `guarantors`/`guarantor_addresses` foram
-- absorvidos pelo cadastro unificado `persons` (papel FIADOR), definido
-- mais abaixo. A tela /fiadores lê `persons` filtrando por roles=FIADOR.
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- Funcionários / colaboradores internos (MOD-FUNC) — recepção,
-- financeiro, administrativo. NÃO é folha de pagamento: o foco é
-- identidade + acesso (RBAC). Todo funcionário é um `users` (MOD-AUTH)
-- com papel(is); esta tabela guarda os metadados de RH e o estado de
-- acesso. Tabela de domínio, protegida por RLS.
-- TODO: cifrar cpf em repouso (AES-256-GCM, PRD funcionarios §4).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cpf           TEXT NOT NULL,
  position      TEXT NOT NULL,                    -- cargo
  hired_at      DATE,                             -- admissão (opcional)
  -- access_status: ATIVO | SUSPENSO | REVOGADO (máquina de estados MOD-FUNC §6).
  -- É a fonte da verdade do acesso; sincroniza users.status (active/disabled).
  access_status TEXT NOT NULL DEFAULT 'ATIVO',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX        IF NOT EXISTS idx_employees_tenant   ON employees (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_user     ON employees (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_cpf      ON employees (tenant_id, cpf);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employees
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON employees TO app_user;

-- ─────────────────────────────────────────────────────────────
-- Pessoas (MOD-PESSOA) — cadastro unificado de partes: LOCADOR,
-- LOCATARIO e FIADOR no MESMO registro, distinguidos por `roles[]`
-- (uma pessoa acumula papéis). Comprador NÃO é papel: o interesse em
-- comprar vem do perfil de busca (intent = COMPRA). Funde os antigos `customers`
-- (lead → cliente/inquilino/comprador: stage, perfil de busca, interações)
-- e `guarantors` (ficha PF/PJ + cônjuge + banco + endereços 1:N).
-- Tabelas de domínio, protegidas por RLS.
-- TODO: cifrar cpf_cnpj/rg/email/phone/banco em repouso (AES-256-GCM).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS persons (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Papéis (1+): LOCADOR | LOCATARIO | FIADOR.
  roles              TEXT[] NOT NULL DEFAULT '{}'
                       CHECK (roles <@ ARRAY['LOCADOR','LOCATARIO','FIADOR']),
  -- Ficha (compat. telas legadas "Cadastro de Locadores/Locatários/Fiadores").
  person_type        TEXT NOT NULL DEFAULT 'PF',    -- PF | PJ
  full_name          TEXT NOT NULL,
  cpf_cnpj           TEXT,                          -- CPF (PF) ou CNPJ (PJ); único por tenant quando presente
  rg                 TEXT,
  rg_issuer          TEXT,
  gender             TEXT,                          -- M | F | OUTRO
  birth_date         DATE,
  marital_status     TEXT,                          -- SOLTEIRO | CASADO | DIVORCIADO | VIUVO | UNIAO_ESTAVEL
  nationality        TEXT DEFAULT 'BRASILEIRA',
  occupation         TEXT,
  email              TEXT,
  phone              TEXT,                          -- ao menos email OU phone (validado no Zod)
  mobile             TEXT,
  bank               TEXT,
  agency             TEXT,
  account            TEXT,
  holder_name        TEXT,
  payment_authorization TEXT,                        -- "Autorização de Depósito/Recebimento" (repasse ao locador)
  spouse_name        TEXT,
  spouse_cpf         TEXT,
  spouse_rg          TEXT,
  spouse_occupation  TEXT,
  spouse_birth_date  DATE,
  notes              TEXT,
  references_txt     TEXT,
  -- Jornada de lead/cliente (relevante p/ LOCATARIO/COMPRADOR):
  stage              TEXT NOT NULL DEFAULT 'LEAD',   -- LEAD | CLIENTE | INQUILINO | COMPRADOR | INATIVO
  source             TEXT NOT NULL DEFAULT 'MANUAL', -- WHATSAPP | INSTAGRAM | SITE | PORTAL | INDICACAO | MANUAL
  assigned_broker_id UUID,                           -- corretor responsável (FK lógica → brokers, módulo futuro)
  status             TEXT NOT NULL DEFAULT 'active', -- active | inactive
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX        IF NOT EXISTS idx_persons_tenant ON persons (tenant_id);
CREATE INDEX        IF NOT EXISTS idx_persons_stage  ON persons (tenant_id, stage);
CREATE INDEX        IF NOT EXISTS idx_persons_roles  ON persons USING GIN (roles);
-- Deduplicação por documento/contato, por tenant (só quando presente).
CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_doc   ON persons (tenant_id, cpf_cnpj)      WHERE cpf_cnpj IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_phone ON persons (tenant_id, phone)         WHERE phone    IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_email ON persons (tenant_id, lower(email))  WHERE email    IS NOT NULL;

-- Endereços (1:N) — residencial/comercial (compat. "Dados Residenciais/Comerciais").
CREATE TABLE IF NOT EXISTS person_addresses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id     UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'RESIDENCIAL', -- RESIDENCIAL | COMERCIAL
  street        TEXT,
  number        TEXT,
  district      TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  phone         TEXT,                                -- contato do bloco (compat. "Dados Residenciais/Comerciais")
  mobile        TEXT,
  fax           TEXT,
  email         TEXT
);
CREATE INDEX IF NOT EXISTS idx_person_addr ON person_addresses (person_id);

-- Perfil de busca (1:N): preferências de imóvel (LOCATARIO/COMPRADOR).
CREATE TABLE IF NOT EXISTS person_search_profiles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id      UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  intent         TEXT NOT NULL,                     -- COMPRA | LOCACAO
  min_price_cents BIGINT,
  max_price_cents BIGINT,
  property_types TEXT[] NOT NULL DEFAULT '{}',
  districts      TEXT[] NOT NULL DEFAULT '{}',
  bedrooms_min   INT,
  parking_min    INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_person_profiles_person ON person_search_profiles (person_id);

-- Interações (append-only): timeline humano/IA por canal. Nunca editar/apagar
-- (RN-02) — correção = nova interação.
CREATE TABLE IF NOT EXISTS person_interactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id   UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,                        -- WHATSAPP | INSTAGRAM | SITE | PORTAL | EMAIL | TELEFONE | MANUAL
  actor       TEXT NOT NULL,                        -- HUMANO | IA
  summary     TEXT NOT NULL,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_person_interactions_person ON person_interactions (person_id, created_at DESC);

-- Vínculo imóvel ↔ dono (proprietário = pessoa com papel LOCADOR) + % participação.
CREATE TABLE IF NOT EXISTS property_owners (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  person_id     UUID NOT NULL REFERENCES persons(id)    ON DELETE RESTRICT,
  share_percent NUMERIC(5,2) NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX        IF NOT EXISTS idx_property_owners_property ON property_owners (property_id);
CREATE INDEX        IF NOT EXISTS idx_property_owners_person   ON property_owners (person_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_owners_uniq     ON property_owners (property_id, person_id);

ALTER TABLE persons                ENABLE ROW LEVEL SECURITY;
ALTER TABLE persons                FORCE  ROW LEVEL SECURITY;
ALTER TABLE person_addresses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_addresses       FORCE  ROW LEVEL SECURITY;
ALTER TABLE person_search_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_search_profiles FORCE  ROW LEVEL SECURITY;
ALTER TABLE person_interactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_interactions    FORCE  ROW LEVEL SECURITY;
ALTER TABLE property_owners        ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_owners        FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON persons
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON person_addresses
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON person_search_profiles
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON person_interactions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON property_owners
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON persons                TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON person_addresses       TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON person_search_profiles TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON person_interactions    TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON property_owners        TO app_user;

-- ── Fotos do imóvel ──────────────────────────────────────────────
-- A imagem mora no object storage (MinIO/S3); a base guarda só a CHAVE
-- (storage_key) + metadados. Leitura no frontend via URL presignada. O
-- cliente redimensiona/comprime antes de enviar.
CREATE TABLE IF NOT EXISTS property_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  storage_key  TEXT NOT NULL,                    -- chave do objeto no bucket
  content_type TEXT,                             -- ex.: image/jpeg
  size_bytes   BIGINT,                           -- tamanho do objeto
  caption      TEXT,
  position     INT  NOT NULL DEFAULT 0,          -- ordem de exibição
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_property_photos_property ON property_photos (property_id, position, created_at);

ALTER TABLE property_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_photos FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON property_photos
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON property_photos TO app_user;

-- ═════════════════════════════════════════════════════════════════
-- MOD-CONTRATO (contratos_08) — contrato de locação: cabeçalho + partes +
-- templates + versões (PDF imutável). Espelha a tela legada "Contratos de
-- Locação". Todas as tabelas com tenant_id + RLS (isolamento é o invariante).
-- ═════════════════════════════════════════════════════════════════

-- Templates de contrato do tenant (HTML com variáveis {{...}}).
CREATE TABLE IF NOT EXISTS contract_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  html        TEXT NOT NULL,
  variables   TEXT[] NOT NULL DEFAULT '{}',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contract_templates_tenant ON contract_templates (tenant_id);

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_templates FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contract_templates
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_templates TO app_user;

-- Contrato (cabeçalho + valores + situação). property_id/template_id são FKs
-- lógicas (soft) — segue o padrão de property_type_id.
CREATE TABLE IF NOT EXISTS contracts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code          INT,                                   -- Contrato (sequencial por tenant)
  property_id   UUID,                                  -- Dados do Imóvel (FK lógica → properties)
  template_id   UUID,                                  -- Template usado na geração (FK lógica)
  status        TEXT NOT NULL DEFAULT 'RASCUNHO',      -- RASCUNHO|EM_ASSINATURA|VIGENTE|RENOVADO|ENCERRADO|DISTRATADO

  -- Cabeçalho / vigência
  starts_at              DATE,                         -- Início
  ends_at                DATE,                         -- Vencto
  term_months            INT,                          -- Meses
  readjust_index         TEXT NOT NULL DEFAULT 'IPCA', -- IPCA|IGP_M|INPC|FIXO
  readjust_period_months INT,                          -- Reaj (periodicidade)
  last_readjust_at       DATE,                         -- Último Reajuste
  owner_pay_day          INT,                          -- Dia Prop
  tenant_pay_day         INT,                          -- Dia Inq
  terminated_at          DATE,                         -- Rescisão

  -- Valores / encargos
  rental_value_cents     BIGINT,                       -- Preço
  interest_percent       NUMERIC(5,2),                 -- Juros
  penalty_percent        NUMERIC(5,2),                 -- Multa
  admin_fee_percent      NUMERIC(5,2),                 -- Taxa Adm
  is_administration      BOOLEAN NOT NULL DEFAULT false, -- Administração
  income_tax_declaration BOOLEAN NOT NULL DEFAULT false, -- Dec (declaração de IR)
  iptu_charged_to        TEXT,                         -- LOCATARIO|LOCADOR
  commission_type        TEXT,                         -- Tipo de Comissão
  has_commission         BOOLEAN NOT NULL DEFAULT false, -- Comissão

  -- Garantia / seguro
  guarantee_kind         TEXT,                         -- FIADOR|CAUCAO|SEGURO_FIANCA|TITULO_CAP
  has_insurance          BOOLEAN NOT NULL DEFAULT false, -- Seguro Fiança
  insurance_description   TEXT,                         -- Descrição do Seguro
  insurance_value_cents   BIGINT,                       -- Seguro

  -- Situação do Contrato (judicial)
  is_settled             BOOLEAN NOT NULL DEFAULT false, -- Liquidado
  has_eviction_order     BOOLEAN NOT NULL DEFAULT false, -- Ordem de Despejo
  has_judicial_execution BOOLEAN NOT NULL DEFAULT false, -- Execução Judicial
  process_number         TEXT,                         -- Nº Processo
  court                  TEXT,                         -- Vara

  -- Cláusulas / fiador
  special_clauses         TEXT,                         -- Cláusulas Especiais
  guarantor_property_info TEXT,                         -- Imóvel do Fiador (texto livre)

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant        ON contracts (tenant_id);
-- "Contrato Nº" é identidade de negócio: dois contratos com o mesmo número
-- confundem locador, locatário e a cobrança. O único torna a corrida visível.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_tenant_code ON contracts (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_status ON contracts (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_ends_at       ON contracts (tenant_id, ends_at) WHERE status = 'VIGENTE';

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contracts
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON contracts TO app_user;

-- Partes do contrato (locador/locatário/fiador — várias por papel). person_id
-- é FK lógica → persons (cadastro unificado).
CREATE TABLE IF NOT EXISTS contract_parties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,                           -- LOCADOR|LOCATARIO|FIADOR
  person_id   UUID NOT NULL,
  signed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, role, person_id)
);
CREATE INDEX IF NOT EXISTS idx_contract_parties_tenant   ON contract_parties (tenant_id);
CREATE INDEX IF NOT EXISTS idx_contract_parties_contract ON contract_parties (contract_id);

ALTER TABLE contract_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_parties FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contract_parties
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_parties TO app_user;

-- Versões do documento gerado (imutável, create-only). Guarda a chave do PDF no
-- object storage (o binário nunca entra no banco).
CREATE TABLE IF NOT EXISTS contract_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  version         INT NOT NULL,
  snapshot_json   JSONB,
  pdf_storage_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, version)
);
CREATE INDEX IF NOT EXISTS idx_contract_versions ON contract_versions (contract_id, version DESC);

ALTER TABLE contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_versions FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contract_versions
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_versions TO app_user;

-- ═════════════════════════════════════════════════════════════════
-- MOD-ASSINATURA — assinatura eletrônica via ZapSign (contratos_08 §91).
-- Cada tenant conecta a PRÓPRIA conta ZapSign; o token fica cifrado
-- (AES-256-GCM, ver backend/src/shared/crypto.ts) — o banco nunca vê o valor.
--
-- As policies abaixo usam DROP IF EXISTS antes do CREATE (diferente do resto do
-- arquivo) porque este bloco também é aplicado em bancos já existentes, sem
-- `npm run infra:reset`.
-- ═════════════════════════════════════════════════════════════════

-- Configuração da integração de assinatura, uma linha por tenant.
CREATE TABLE IF NOT EXISTS tenant_signature_settings (
  tenant_id             UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL DEFAULT 'ZAPSIGN',
  api_token_enc         TEXT,                             -- token cifrado (v1.<iv>.<tag>.<ct>)
  api_token_hint        TEXT,                             -- últimos 4 caracteres, só p/ exibir
  sandbox               BOOLEAN NOT NULL DEFAULT true,    -- usa sandbox.api.zapsign.com.br
  auth_mode             TEXT NOT NULL DEFAULT 'assinaturaTela-tokenEmail',
  webhook_secret        TEXT,                             -- header que autentica o callback
  webhook_registered_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_signature_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_signature_settings FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_signature_settings;
CREATE POLICY tenant_isolation ON tenant_signature_settings
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_signature_settings TO app_user;

-- Envelope de assinatura: um por envio do contrato ao provedor. `version` é a
-- versão de contract_versions que foi enviada; provider_doc_token é a chave de
-- correlação com o webhook (por isso UNIQUE).
CREATE TABLE IF NOT EXISTS contract_signature_envelopes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id            UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  version                INT,
  provider               TEXT NOT NULL DEFAULT 'ZAPSIGN',
  provider_doc_token     TEXT NOT NULL UNIQUE,
  status                 TEXT NOT NULL DEFAULT 'PENDENTE', -- PENDENTE|ASSINADO|RECUSADO|CANCELADO|EXPIRADO
  auth_mode              TEXT NOT NULL,
  sandbox                BOOLEAN NOT NULL DEFAULT false,
  signed_pdf_storage_key TEXT,                             -- PDF assinado no nosso storage
  provider_snapshot      JSONB,                            -- último estado do provedor (auditoria)
  signed_at              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signature_envelopes_tenant   ON contract_signature_envelopes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_signature_envelopes_contract ON contract_signature_envelopes (contract_id, created_at DESC);

ALTER TABLE contract_signature_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_signature_envelopes FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON contract_signature_envelopes;
CREATE POLICY tenant_isolation ON contract_signature_envelopes
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_signature_envelopes TO app_user;

-- Signatários do envelope. party_id liga de volta a contract_parties (cuja
-- coluna signed_at é espelhada aqui) — ON DELETE SET NULL para o histórico de
-- assinatura sobreviver à remoção de uma parte do contrato.
CREATE TABLE IF NOT EXISTS contract_signature_signers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  envelope_id           UUID NOT NULL REFERENCES contract_signature_envelopes(id) ON DELETE CASCADE,
  party_id              UUID REFERENCES contract_parties(id) ON DELETE SET NULL,
  provider_signer_token TEXT NOT NULL,
  role                  TEXT,                              -- LOCADOR|LOCATARIO|FIADOR (cópia p/ exibir)
  name                  TEXT NOT NULL,
  email                 TEXT,
  sign_url              TEXT,
  status                TEXT NOT NULL DEFAULT 'PENDENTE',  -- PENDENTE|ASSINADO|RECUSADO
  signed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (envelope_id, provider_signer_token)
);
CREATE INDEX IF NOT EXISTS idx_signature_signers_tenant   ON contract_signature_signers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_signature_signers_envelope ON contract_signature_signers (envelope_id);

ALTER TABLE contract_signature_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_signature_signers FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON contract_signature_signers;
CREATE POLICY tenant_isolation ON contract_signature_signers
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_signature_signers TO app_user;

-- Template padrão de locação residencial (seed do tenant demo). O texto usa
-- variáveis {{...}} resolvidas pelo contract-service na geração do PDF.
INSERT INTO contract_templates (tenant_id, name, html, variables)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Contrato de Locação Residencial (padrão)',
  $tpl$CONTRATO DE LOCAÇÃO RESIDENCIAL

LOCADOR(ES): {{locador.nome}}, {{locador.nacionalidade}}, {{locador.estado_civil}}, {{locador.profissao}}, portador(a) do RG nº {{locador.rg}} {{locador.rg_orgao}} e inscrito(a) no CPF/CNPJ sob nº {{locador.cpf_cnpj}}, residente e domiciliado(a) em {{locador.endereco}}, {{locador.cidade}}/{{locador.uf}}.

LOCATÁRIO(S): {{locatario.nome}}, {{locatario.nacionalidade}}, {{locatario.estado_civil}}, {{locatario.profissao}}, portador(a) do RG nº {{locatario.rg}} {{locatario.rg_orgao}} e inscrito(a) no CPF/CNPJ sob nº {{locatario.cpf_cnpj}}.

FIADOR(ES): {{fiadores.nomes}}.

As partes acima identificadas têm, entre si, justo e contratado o presente Contrato de Locação Residencial, que se regerá pelas cláusulas seguintes e pelas condições da Lei nº 8.245/91.

CLÁUSULA 1ª — DO OBJETO

O LOCADOR dá em locação ao LOCATÁRIO o imóvel situado em {{imovel.endereco}}, {{imovel.cidade}}/{{imovel.uf}}, destinado exclusivamente a fins residenciais.

CLÁUSULA 2ª — DO PRAZO

A locação tem prazo de {{contrato.meses}} meses, com início em {{contrato.inicio}} e término em {{contrato.vencimento}}, independentemente de aviso, notificação ou interpelação judicial ou extrajudicial.

CLÁUSULA 3ª — DO ALUGUEL

O aluguel mensal é de R$ {{contrato.valor}}, a ser pago até o dia {{contrato.dia_pagamento}} de cada mês. O valor será reajustado a cada {{contrato.periodo_reajuste}} meses pelo índice {{contrato.indice_reajuste}}.

CLÁUSULA 4ª — DOS ENCARGOS E DA MORA

O atraso no pagamento sujeitará o LOCATÁRIO a multa de {{contrato.multa}}% e juros de {{contrato.juros}}% ao mês sobre o valor em atraso, sem prejuízo da correção monetária. O IPTU do imóvel será suportado pelo {{contrato.iptu_responsavel}}.

CLÁUSULA 5ª — DA GARANTIA

Para garantia das obrigações assumidas, fica constituída garantia locatícia na modalidade {{contrato.garantia}}, respondendo o(s) garantidor(es) solidariamente até a efetiva entrega das chaves.

CLÁUSULA 6ª — DAS DISPOSIÇÕES GERAIS

{{contrato.clausulas_especiais}}

E, por estarem assim justas e contratadas, as partes assinam o presente em duas vias de igual teor.

{{imovel.cidade}}, {{contrato.data_hoje}}.


_______________________________
LOCADOR

_______________________________
LOCATÁRIO

_______________________________
FIADOR$tpl$,
  ARRAY[
    'locador.nome','locador.nacionalidade','locador.estado_civil','locador.profissao',
    'locador.rg','locador.rg_orgao','locador.cpf_cnpj','locador.endereco',
    'locador.cidade','locador.uf',
    'locatario.nome','locatario.nacionalidade','locatario.estado_civil',
    'locatario.profissao','locatario.rg','locatario.rg_orgao','locatario.cpf_cnpj',
    'fiadores.nomes',
    'imovel.endereco','imovel.cidade','imovel.uf',
    'contrato.meses','contrato.inicio','contrato.vencimento','contrato.valor',
    'contrato.dia_pagamento','contrato.periodo_reajuste','contrato.indice_reajuste',
    'contrato.multa','contrato.juros','contrato.iptu_responsavel','contrato.garantia',
    'contrato.clausulas_especiais','contrato.data_hoje'
  ]
)
ON CONFLICT DO NOTHING;

-- Seed de pessoas demo (ids fixos p/ idempotência). Roda como superusuário do
-- init (bypassa RLS). Dá dado real às páginas /clientes e /fiadores.
INSERT INTO persons (id, tenant_id, roles, person_type, full_name, cpf_cnpj, email, phone, stage, source) VALUES
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-000000000001', '{LOCATARIO}', 'PF', 'Ana Lima',            NULL,          'ana.lima@example.com',    '11990001111', 'LEAD',      'WHATSAPP'),
  ('00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-000000000001', '{LOCATARIO}', 'PF', 'Pedro Nogueira',      NULL,          'pedro.n@example.com',     '11990002222', 'CLIENTE',   'SITE'),
  ('00000000-0000-0000-0000-0000000c0003', '00000000-0000-0000-0000-000000000001', '{LOCATARIO}', 'PF', 'Família Ribeiro',     NULL,          NULL,                      '11990003333', 'INQUILINO', 'INDICACAO'),
  ('00000000-0000-0000-0000-0000000c0004', '00000000-0000-0000-0000-000000000001', '{LOCADOR}',   'PF', 'Carlos Proprietário', '52998224725', 'carlos.prop@example.com', '11990004444', 'CLIENTE',   'MANUAL'),
  ('00000000-0000-0000-0000-0000000c0005', '00000000-0000-0000-0000-000000000001', '{FIADOR}',    'PF', 'Marina Fiadora',      '39053344705', 'marina.f@example.com',    '11990005555', 'CLIENTE',   'MANUAL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO person_search_profiles (tenant_id, person_id, intent, min_price_cents, max_price_cents, districts) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000c0001', 'LOCACAO', NULL, 300000,   '{Centro}'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000c0002', 'COMPRA',  NULL, 90000000, '{"Zona Sul"}'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000c0003', 'LOCACAO', NULL, 320000,   '{Centro}')
ON CONFLICT DO NOTHING;

-- Vincula o primeiro imóvel demo a um dono (LOCADOR). Imóveis têm id aleatório,
-- por isso seleciona o mais antigo do tenant.
INSERT INTO property_owners (tenant_id, property_id, person_id, share_percent)
SELECT '00000000-0000-0000-0000-000000000001', p.id, '00000000-0000-0000-0000-0000000c0004', 100
FROM properties p
WHERE p.tenant_id = '00000000-0000-0000-0000-000000000001'
ORDER BY p.created_at
LIMIT 1
ON CONFLICT DO NOTHING;

-- ═════════════════════════════════════════════════════════════════
-- MOD-FIN — Contas a receber (financeiro_11 §4).
--
-- Origem hoje: as parcelas de aluguel geradas quando o contrato passa a
-- VIGENTE (todas as assinaturas confirmadas). O par (contract_id, kind,
-- competence) é ÚNICO — é ele que torna a geração idempotente: reenviar o
-- webhook da ZapSign nunca duplica um aluguel.
--
-- Como o resto do arquivo já roda em bancos existentes, este bloco usa
-- DROP POLICY IF EXISTS antes do CREATE POLICY.
-- ═════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS receivables (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id        UUID REFERENCES contracts(id) ON DELETE CASCADE,
  property_id        UUID,                              -- FK lógica → properties
  payer_person_id    UUID,                              -- FK lógica → persons (locatário)
  kind               TEXT NOT NULL DEFAULT 'ALUGUEL',   -- ALUGUEL|IPTU|CONDOMINIO|MULTA|OUTRO
  description        TEXT,
  competence         TEXT,                              -- YYYY-MM (mês de referência)
  installment        INT,                               -- nº da parcela (1-based)
  installments_total INT,                               -- total de parcelas do contrato
  amount_cents       BIGINT NOT NULL,
  due_date           DATE NOT NULL,
  status             TEXT NOT NULL DEFAULT 'ABERTO',    -- ABERTO|PAGO|VENCIDO|CANCELADO|ESTORNADO
  paid_at            DATE,
  paid_amount_cents  BIGINT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receivables_tenant_status ON receivables (tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_receivables_contract      ON receivables (contract_id, due_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_receivables_competence
  ON receivables (contract_id, kind, competence)
  WHERE contract_id IS NOT NULL AND competence IS NOT NULL;

ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivables FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON receivables;
CREATE POLICY tenant_isolation ON receivables
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON receivables TO app_user;

-- Cobrança bancária (Asaas) — colunas preparadas para a integração do MOD-FIN.
-- Enquanto a conta não é conectada elas ficam nulas e a UI mostra o boleto como
-- indisponível; quando a cobrança for emitida, `boleto_url` é o PDF do próprio
-- provedor (é ele quem tem o código de barras registrado, não nós).
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS asaas_charge_id TEXT;
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS boleto_url      TEXT;  -- bankSlipUrl
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS invoice_url     TEXT;  -- fatura/link de pagamento
CREATE INDEX IF NOT EXISTS idx_receivables_asaas ON receivables (asaas_charge_id)
  WHERE asaas_charge_id IS NOT NULL;

-- Cobrança de condomínio (kind = 'CONDOMINIO'): a conta nasce da tela
-- /condominios/cobranca, que rateia as despesas do período entre as unidades e
-- soma o valor de condomínio do imóvel. `condominium_id` é FK lógica → condominiums
-- (o imóvel pode mudar de condomínio depois; a cobrança fica onde foi emitida).
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS condominium_id UUID;
CREATE INDEX IF NOT EXISTS idx_receivables_condominium
  ON receivables (condominium_id, competence)
  WHERE condominium_id IS NOT NULL;
-- Idempotência: um imóvel só é cobrado uma vez por competência. É o que faz a
-- segunda geração do mesmo período criar 0 linhas em vez de duplicar a conta.
-- Cobrança CANCELADA fica fora do índice de propósito: cancelar é justamente
-- como se corrige um lote errado, e sem essa exceção o período ficaria travado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_receivables_condo_charge
  ON receivables (tenant_id, property_id, competence)
  WHERE kind = 'CONDOMINIO' AND property_id IS NOT NULL AND competence IS NOT NULL
    AND status <> 'CANCELADO';

-- ═════════════════════════════════════════════════════════════════
-- MOD-FIN / Asaas — cobrança bancária (financeiro_11 §2 e §8).
--
-- Mesmo desenho da integração de assinatura: cada tenant conecta a PRÓPRIA
-- conta Asaas e a chave fica cifrada (AES-256-GCM, shared/crypto.ts).
--
-- Bloco aplicável a bancos já existentes: DROP POLICY antes do CREATE.
-- ═════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tenant_payment_settings (
  tenant_id             UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL DEFAULT 'ASAAS',
  api_key_enc           TEXT,                             -- chave cifrada (v1.<iv>.<tag>.<ct>)
  api_key_hint          TEXT,                             -- últimos 4 caracteres, só p/ exibir
  sandbox               BOOLEAN NOT NULL DEFAULT true,    -- api-sandbox.asaas.com
  billing_type          TEXT NOT NULL DEFAULT 'UNDEFINED',-- UNDEFINED = boleto + PIX na fatura
  webhook_token         TEXT,                             -- authToken devolvido no header do callback
  webhook_registered_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_payment_settings FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_payment_settings;
CREATE POLICY tenant_isolation ON tenant_payment_settings
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_payment_settings TO app_user;

-- Espelho pessoa ↔ cliente no Asaas. `sandbox` faz parte da chave porque os
-- ambientes são contas distintas: o customer de sandbox não existe em produção.
CREATE TABLE IF NOT EXISTS asaas_customers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id         UUID NOT NULL,                        -- FK lógica → persons
  sandbox           BOOLEAN NOT NULL,
  asaas_customer_id TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, person_id, sandbox)
);
CREATE INDEX IF NOT EXISTS idx_asaas_customers_tenant ON asaas_customers (tenant_id);

ALTER TABLE asaas_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE asaas_customers FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON asaas_customers;
CREATE POLICY tenant_isolation ON asaas_customers
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON asaas_customers TO app_user;

-- Eventos já processados do webhook. É o que garante a idempotência exigida
-- pelo AC-01 de MOD-FIN-03: o Asaas reentrega o evento até receber 200.
CREATE TABLE IF NOT EXISTS asaas_webhook_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id     TEXT NOT NULL,                             -- id do evento no Asaas
  event_type   TEXT NOT NULL,
  payment_id   TEXT,
  payload      JSONB,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_asaas_events_tenant ON asaas_webhook_events (tenant_id, processed_at DESC);

ALTER TABLE asaas_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE asaas_webhook_events FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON asaas_webhook_events;
CREATE POLICY tenant_isolation ON asaas_webhook_events
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON asaas_webhook_events TO app_user;

-- ═════════════════════════════════════════════════════════════════
-- MOD-AI — camada de agentes de IA (docs/prd/agentes_ia_20.md §4).
--
-- Duas metades:
--  1. Conversa auditada  — agent_conversations / _messages / _tool_calls.
--     O conteúdo trafega cifrado (sufixo _enc, AES-256-GCM de shared/crypto.ts):
--     uma pergunta da equipe pode citar valor de contrato, nome e telefone. O
--     sufixo também avisa quem for escrever SQL depois que a coluna NÃO é
--     pesquisável — filtrar por LIKE ali nunca vai casar.
--  2. Índice do RAG      — rag_index_meta (o que foi indexado) e rag_chunks
--     (os vetores). O PRD só nomeia a primeira; os embeddings precisam de casa
--     própria porque a granularidade é outra (uma entidade → N pedaços).
--
-- Mais os créditos (ai_credits), que são o gate econômico de cada pergunta.
--
-- O isolamento é o mesmo do resto do sistema: tenant_id + RLS. Vale reler a
-- nota sobre HNSW abaixo — é o único ponto onde o índice não é por tenant.
--
-- Bloco aplicável a bancos já existentes: DROP POLICY antes do CREATE.
-- ═════════════════════════════════════════════════════════════════

-- ── Conversas ────────────────────────────────────────────────────
-- `channel` já contempla os canais externos (MOD-AI-01) mesmo que a fatia atual
-- só use WEB: mudar schema aqui exige recriar o volume, então é mais barato
-- nascer com o domínio completo.
CREATE TABLE IF NOT EXISTS agent_conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id           UUID,                                  -- FK lógica → persons (cliente final)
  user_id             UUID,                                  -- FK lógica → users (equipe, no copiloto)
  channel             TEXT NOT NULL DEFAULT 'WEB'
    CHECK (channel IN ('WEB', 'WHATSAPP', 'INSTAGRAM', 'EMAIL')),
  status              TEXT NOT NULL DEFAULT 'ATIVA'
    CHECK (status IN ('ATIVA', 'HANDOFF', 'ENCERRADA')),
  -- Sentimento da última mensagem do usuário (POS/NEU/NEG). Alimenta a regra de
  -- handoff do MOD-AI-09 junto com unresolved_attempts.
  sentiment           TEXT CHECK (sentiment IN ('POS', 'NEU', 'NEG')),
  unresolved_attempts INT NOT NULL DEFAULT 0,
  title               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_tenant
  ON agent_conversations (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_status
  ON agent_conversations (tenant_id, status);

ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_conversations;
CREATE POLICY tenant_isolation ON agent_conversations
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_conversations TO app_user;

-- ── Mensagens (append-only) ──────────────────────────────────────
-- Nunca sofre UPDATE: o histórico é a auditoria. `tokens` guarda o consumo real
-- devolvido pelo provedor, que é o que fecha a conta dos créditos.
CREATE TABLE IF NOT EXISTS agent_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content_enc     TEXT NOT NULL,                             -- cifrado; não pesquisável
  tokens          INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation
  ON agent_messages (conversation_id, created_at);

ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_messages;
CREATE POLICY tenant_isolation ON agent_messages
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_messages TO app_user;

-- ── Chamadas de ferramenta (trilha de auditoria) ─────────────────
-- `input` fica em claro (é o filtro que o agente montou — útil para depurar por
-- que ele achou o que achou); `output_enc` é cifrado porque carrega o dado de
-- domínio devolvido. `status` inclui DENIED: a ferramenta existiu, o agente
-- pediu, e o RBAC do usuário recusou — isso precisa aparecer na auditoria.
CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  message_id      UUID REFERENCES agent_messages(id) ON DELETE SET NULL,
  tool            TEXT NOT NULL,
  input           JSONB,
  output_enc      TEXT,                                      -- cifrado; não pesquisável
  status          TEXT NOT NULL DEFAULT 'OK'
    CHECK (status IN ('OK', 'ERROR', 'DENIED')),
  duration_ms     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_conversation
  ON agent_tool_calls (conversation_id, created_at);

ALTER TABLE agent_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_calls FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_tool_calls;
CREATE POLICY tenant_isolation ON agent_tool_calls
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_tool_calls TO app_user;

-- ── Créditos de IA ───────────────────────────────────────────────
-- Uma linha por tenant. `reserved` é o dinheiro empenhado enquanto a chamada ao
-- LLM está no ar: sem ele, duas perguntas simultâneas passariam as duas pelo
-- teste de saldo e a segunda estouraria o limite. Disponível = balance - reserved.
-- Os CHECKs impedem que um estorno duplicado deixe o saldo negativo.
CREATE TABLE IF NOT EXISTS ai_credits (
  tenant_id  UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  balance    BIGINT NOT NULL DEFAULT 0 CHECK (balance  >= 0),
  reserved   BIGINT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  used       BIGINT NOT NULL DEFAULT 0 CHECK (used     >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credits FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_credits;
CREATE POLICY tenant_isolation ON ai_credits
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_credits TO app_user;

-- ── RAG: o que já foi indexado ───────────────────────────────────
-- `content_hash` é o que evita reembeddar (chamada paga) quando o evento chega
-- mas o texto renderizado não mudou — salvar um imóvel só para corrigir uma
-- observação não deveria custar nada.
CREATE TABLE IF NOT EXISTS rag_index_meta (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,                                 -- 'property' (por ora)
  entity_id   UUID NOT NULL,
  content_hash TEXT NOT NULL,
  chunk_count INT NOT NULL DEFAULT 0,
  indexed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, entity_id)
);

ALTER TABLE rag_index_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_index_meta FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rag_index_meta;
CREATE POLICY tenant_isolation ON rag_index_meta
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON rag_index_meta TO app_user;

-- ── RAG: os vetores ──────────────────────────────────────────────
-- `embedding` é vector(1024) porque é a dimensão do voyage-3 (VOYAGE_MODEL).
-- Trocar de modelo muda a dimensão e invalida a tabela inteira — daí a nota no
-- env.ts. `content` fica em claro: é texto derivado de campos que o usuário já
-- pode ler pela tela do imóvel, e precisa ir literal para o prompt.
CREATE TABLE IF NOT EXISTS rag_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  chunk_index INT  NOT NULL DEFAULT 0,
  content     TEXT NOT NULL,
  embedding   vector(1024) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reindexação incremental apaga e reinsere por entidade; sem este índice o
-- DELETE varreria a tabela toda a cada imóvel salvo.
CREATE INDEX IF NOT EXISTS idx_rag_chunks_entity
  ON rag_chunks (tenant_id, entity_type, entity_id);

-- Busca por similaridade de cosseno (o operador é <=>).
--
-- NOTA (HNSW + RLS): este índice é GLOBAL — o grafo ANN não conhece tenant. O
-- filtro por tenant continua sendo aplicado pela policy, sobre as linhas que o
-- índice devolve; não há vazamento, o RLS segue sendo o gate. O efeito colateral
-- é de RECALL: com muitos tenants, os k vizinhos globais podem incluir linhas de
-- outros tenants que o RLS descarta, e a busca volta com menos que k resultados.
-- Na escala atual (milhares de imóveis) isso não aparece; se aparecer, os ajustes
-- são subir `hnsw.ef_search` ou particionar o índice por tenant.
CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding
  ON rag_chunks USING hnsw (embedding vector_cosine_ops);

ALTER TABLE rag_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_chunks FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rag_chunks;
CREATE POLICY tenant_isolation ON rag_chunks
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON rag_chunks TO app_user;

-- Saldo inicial do tenant demo, para o copiloto responder já no primeiro uso.
INSERT INTO ai_credits (tenant_id, balance)
VALUES ('00000000-0000-0000-0000-000000000001', 10000)
ON CONFLICT (tenant_id) DO NOTHING;

-- ═════════════════════════════════════════════════════════════════
-- MOD-FIN / Repasse ao proprietário — contas a pagar (financeiro_11 §4).
--
-- Cada aluguel PAGO vira um lançamento a pagar por proprietário do imóvel,
-- rateado por `property_owners.share_percent`, já com a taxa de administração
-- deduzida. A taxa NÃO vira linha própria: fica em `admin_fee_cents` no mesmo
-- lançamento, e a receita da imobiliária no período é o SUM dessa coluna. Uma
-- linha só evita as duas fontes de verdade divergirem quando alguém edita ou
-- cancela o repasse.
--
-- Os percentuais são SNAPSHOT do momento da baixa: mudar a taxa do contrato
-- amanhã não pode reescrever o que já foi apurado.
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
  share_percent      NUMERIC(5,2) NOT NULL DEFAULT 100, -- participação do dono
  gross_cents        BIGINT NOT NULL,                 -- parte bruta deste dono
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
-- Idempotência do repasse: reprocessar a baixa (webhook reentregue, botão
-- clicado duas vezes, rotina de reconciliação) não pode pagar o dono em dobro.
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
-- O repasse sai por PIX: uma chave só, cai na hora e sem tarifa de TED. Os
-- campos banco/agência/conta acima continuam servindo de registro do cadastro,
-- mas não é deles que a transferência sai.
-- `pix_key_type` usa a nomenclatura do próprio Asaas (CPF|CNPJ|EMAIL|PHONE|EVP)
-- para não haver tradução no meio do caminho — EVP é a chave aleatória.
ALTER TABLE persons ADD COLUMN IF NOT EXISTS pix_key      TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS pix_key_type TEXT;

-- ── Transferência do repasse (Asaas) ─────────────────────────────
-- A transferência é assíncrona: o Asaas responde PENDING e só depois manda
-- TRANSFER_DONE/TRANSFER_FAILED. Por isso o repasse ganha um estado próprio
-- (PROCESSANDO) entre "em aberto" e "pago" — marcar PAGO na criação diria que o
-- proprietário recebeu um dinheiro que ainda está em trânsito.
ALTER TABLE payables ADD COLUMN IF NOT EXISTS asaas_transfer_id      TEXT;
ALTER TABLE payables ADD COLUMN IF NOT EXISTS transfer_status        TEXT;
ALTER TABLE payables ADD COLUMN IF NOT EXISTS transfer_failed_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_payables_transfer ON payables (asaas_transfer_id)
  WHERE asaas_transfer_id IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════
-- MOD-DOC (documental_09) — repositório documental com vínculo polimórfico
-- e versionamento. O binário mora no bucket (mesma infraestrutura das fotos de
-- imóvel); aqui ficam só os metadados e a chave do objeto.
--
-- `entity_type` NÃO segue a lista do PRD (PROPERTY/OWNER/CUSTOMER/CONTRACT):
-- aqui locador, locatário e fiador são a MESMA entidade (`persons` com
-- `roles[]`), então são um único PERSON. Ver o cabeçalho de MOD-PESSOA acima.
--
-- `status` guarda só ATIVO|EXPURGADO. "Expirado" é DERIVADO de `expires_at` na
-- leitura, não gravado: sem agendador no backend, um status persistido ficaria
-- mentindo até alguém rodar uma rotina.
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
  mime            TEXT,                           -- idem
  size_bytes      BIGINT,
  expires_at      DATE,                           -- validade (opcional)
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

-- Versões (append-only): substituir um documento nunca apaga o anterior — a
-- versão antiga é a prova do que valia antes. Só o expurgo LGPD remove binário.
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_versions_uniq
  ON document_versions (document_id, version);
CREATE INDEX IF NOT EXISTS idx_doc_versions ON document_versions (document_id, version DESC);

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document_versions;
CREATE POLICY tenant_isolation ON document_versions
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON document_versions TO app_user;

-- ═════════════════════════════════════════════════════════════════
-- MOD-AUTH-07 / MOD-SADMIN-04 — Trilha de auditoria (SPEC 9.4)
-- ═════════════════════════════════════════════════════════════════
-- Registro IMUTÁVEL de quem fez o quê, quando e de onde. A imutabilidade não é
-- uma promessa do código: `app_user` recebe SELECT e INSERT, e **nenhum**
-- UPDATE. Nem um bug nem uma rota nova conseguem reescrever a trilha.
--
-- A policy aceita duas condições, como a de `tenants`: o próprio tenant
-- (Admin vendo a própria trilha) ou `app.platform = 'on'` (Super Admin vendo
-- todas — SPEC 9.4). O NULLIF é obrigatório pelo mesmo motivo de lá: ao fim de
-- uma transação o `app.tenant_id` local reverte para string VAZIA, e ''::uuid
-- explodiria numa conexão reciclada do pool.
--
-- `actor_label` guarda o nome/e-mail de quem agiu NO MOMENTO da ação: se o
-- usuário for anonimizado por pedido LGPD depois, a trilha ainda diz quem era.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,  -- nulo p/ ator não-humano (webhook)
  actor_label TEXT,
  action      TEXT NOT NULL,                      -- entidade.acao (ex.: contract.signed)
  entity      TEXT NOT NULL,                      -- property | contract | receivable | ...
  entity_id   TEXT,                               -- id do alvo (texto: nem todo alvo é uuid)
  payload     JSONB,                              -- corpo REDIGIDO (ver audit.redact.ts)
  ip_address  INET,
  request_id  TEXT,
  status      TEXT NOT NULL DEFAULT 'OK'
                CHECK (status IN ('OK','DENIED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created
  ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_action
  ON audit_logs (tenant_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON audit_logs (tenant_id, entity, entity_id);
-- Visão global do Super Admin: ordena por data atravessando tenants.
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);

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

-- Única remoção permitida: o expurgo de retenção (LGPD, PRD 01 seção 9 — o IP
-- é retido por 12 meses). Escopo de plataforma E linha vencida; uma linha
-- recente é indeletável mesmo para o Super Admin. Sem agendador no projeto, o
-- expurgo é disparado à mão por POST /admin/audit/purge.
DROP POLICY IF EXISTS audit_purge ON audit_logs;
CREATE POLICY audit_purge ON audit_logs FOR DELETE
  USING (
    current_setting('app.platform', true) = 'on'
    AND created_at < now() - interval '12 months'
  );

-- Sem UPDATE: nem no GRANT, nem em policy. A trilha só cresce.
GRANT SELECT, INSERT, DELETE ON audit_logs TO app_user;
