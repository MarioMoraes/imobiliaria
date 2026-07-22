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

ALTER TABLE banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE banks FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON banks
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON banks TO app_user;

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
  balance_cents         BIGINT NOT NULL DEFAULT 0,        -- Saldo (derivado)
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
