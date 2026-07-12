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

-- Papel da aplicação (não-superusuário → RLS é aplicado).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;

-- ── Registro de tenants (nível plataforma, sem RLS) ──────────────
CREATE TABLE IF NOT EXISTS tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,        -- subdomínio: <slug>.moveai.com.br
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
  -- SUPER_ADMIN | ADMIN | GESTOR | CORRETOR | FINANCEIRO | PROPRIETARIO | CLIENTE | AI_AGENT
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
-- tenants é nível-plataforma (sem RLS): o CRUD administrativo escreve aqui.
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
        'admin@demo.moveai.com.br', 'Admin Demo', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (tenant_id, user_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'ADMIN')
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
-- Fiadores (MOD-FIADOR) — cadastro novo (compat. tela "Cadastro de Fiadores").
-- Ficha PF/PJ + cônjuge (colunas) + endereços (tabela 1:N).
-- TODO: criptografar cpf_cnpj/rg/banco em repouso (AES-256-GCM, PRD §4/9).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guarantors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_type    TEXT NOT NULL DEFAULT 'PF',   -- PF | PJ
  cpf_cnpj       TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  rg             TEXT,
  rg_issuer      TEXT,
  gender         TEXT,                          -- M | F | OUTRO
  birth_date     DATE,
  marital_status TEXT,                          -- SOLTEIRO | CASADO | ...
  nationality    TEXT DEFAULT 'BRASILEIRA',
  occupation     TEXT,
  email          TEXT,
  phone          TEXT,
  mobile         TEXT,
  bank           TEXT,
  agency         TEXT,
  account        TEXT,
  holder_name    TEXT,
  spouse_name    TEXT,
  spouse_cpf     TEXT,
  notes          TEXT,
  references_txt TEXT,
  status         TEXT NOT NULL DEFAULT 'active', -- active | inactive
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guarantors_tenant ON guarantors (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_guarantors_tenant_doc ON guarantors (tenant_id, cpf_cnpj);

CREATE TABLE IF NOT EXISTS guarantor_addresses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  guarantor_id  UUID NOT NULL REFERENCES guarantors(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'RESIDENCIAL', -- RESIDENCIAL | COMERCIAL
  street        TEXT,
  number        TEXT,
  district      TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT
);
CREATE INDEX IF NOT EXISTS idx_guarantor_addr ON guarantor_addresses (guarantor_id);

ALTER TABLE guarantors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE guarantors          FORCE  ROW LEVEL SECURITY;
ALTER TABLE guarantor_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE guarantor_addresses FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON guarantors
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON guarantor_addresses
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON guarantors          TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON guarantor_addresses TO app_user;

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
-- Clientes / cliente unificado (MOD-CLIENTE) — lead, cliente,
-- inquilino e comprador no MESMO registro, distinguidos por `stage`.
-- customers = ficha-base; perfis de busca (1:N) e interações
-- (append-only) em tabelas filhas. Tabelas de domínio, com RLS.
-- TODO: cifrar cpf/email/phone em repouso (AES-256-GCM, PRD clientes §4).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name          TEXT NOT NULL,
  cpf                TEXT,                          -- único por tenant quando presente
  email              TEXT,
  phone              TEXT,                          -- ao menos email OU phone (validado no Zod)
  -- stage: LEAD | CLIENTE | INQUILINO | COMPRADOR | INATIVO (máquina de estados §6)
  stage              TEXT NOT NULL DEFAULT 'LEAD',
  -- source: WHATSAPP | INSTAGRAM | SITE | PORTAL | INDICACAO | MANUAL
  source             TEXT NOT NULL DEFAULT 'MANUAL',
  assigned_broker_id UUID,                          -- corretor responsável (FK lógica → brokers, módulo futuro)
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX        IF NOT EXISTS idx_customers_tenant       ON customers (tenant_id);
CREATE INDEX        IF NOT EXISTS idx_customers_stage        ON customers (tenant_id, stage);
CREATE INDEX        IF NOT EXISTS idx_customers_broker       ON customers (assigned_broker_id);
-- Unicidade de contato por tenant (só quando presente) — base da deduplicação.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_cpf   ON customers (tenant_id, cpf)          WHERE cpf   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone ON customers (tenant_id, phone)        WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email ON customers (tenant_id, lower(email)) WHERE email IS NOT NULL;

-- Perfil de busca (1:N): um cliente pode ter várias intenções de compra/locação.
CREATE TABLE IF NOT EXISTS customer_search_profiles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  intent         TEXT NOT NULL,                     -- COMPRA | LOCACAO
  min_price_cents BIGINT,
  max_price_cents BIGINT,
  property_types TEXT[] NOT NULL DEFAULT '{}',
  districts      TEXT[] NOT NULL DEFAULT '{}',
  bedrooms_min   INT,
  parking_min    INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cust_profiles_customer ON customer_search_profiles (customer_id);

-- Interações (append-only): timeline de contatos humano/IA por canal. Nunca
-- editar/apagar (RN-02) — correção = nova interação.
CREATE TABLE IF NOT EXISTS customer_interactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,                        -- WHATSAPP | INSTAGRAM | SITE | PORTAL | EMAIL | TELEFONE | MANUAL
  actor       TEXT NOT NULL,                        -- HUMANO | IA
  summary     TEXT NOT NULL,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cust_interactions_customer ON customer_interactions (customer_id, created_at DESC);

ALTER TABLE customers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers                FORCE  ROW LEVEL SECURITY;
ALTER TABLE customer_search_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_search_profiles FORCE  ROW LEVEL SECURITY;
ALTER TABLE customer_interactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_interactions    FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON customer_search_profiles
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON customer_interactions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON customers                TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_search_profiles TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_interactions    TO app_user;

-- Seed de clientes demo (ids fixos p/ idempotência). Roda como superusuário do
-- init (bypassa RLS, como o seed de imóveis). Dá dado real à página /clientes.
INSERT INTO customers (id, tenant_id, full_name, email, phone, stage, source) VALUES
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-000000000001', 'Ana Lima',        'ana.lima@example.com',  '11990001111', 'LEAD',      'WHATSAPP'),
  ('00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-000000000001', 'Pedro Nogueira',  'pedro.n@example.com',   '11990002222', 'CLIENTE',   'SITE'),
  ('00000000-0000-0000-0000-0000000c0003', '00000000-0000-0000-0000-000000000001', 'Família Ribeiro', NULL,                    '11990003333', 'INQUILINO', 'INDICACAO')
ON CONFLICT (id) DO NOTHING;

INSERT INTO customer_search_profiles (tenant_id, customer_id, intent, min_price_cents, max_price_cents, districts) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000c0001', 'LOCACAO', NULL, 300000,    '{Centro}'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000c0002', 'COMPRA',  NULL, 90000000,  '{"Zona Sul"}'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000c0003', 'LOCACAO', NULL, 320000,    '{Centro}')
ON CONFLICT DO NOTHING;
