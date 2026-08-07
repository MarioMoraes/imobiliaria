-- ═════════════════════════════════════════════════════════════════
-- Delta de `init.sql` desde 2026-07-31 (5a38bb3) — o que entrou depois do
-- último deploy: cobrança de condomínio, fluxo de caixa (comissões,
-- categorias, lançamento manual) e venda de imóvel.
--
-- `init.sql` só roda na criação do volume do Postgres: um banco que já existe
-- nunca vê as tabelas novas. Sem este arquivo, as telas de Fluxo de Caixa,
-- Vendas e Cobrança de Condomínio quebram em produção com "tabela inexistente".
--
-- É IDEMPOTENTE: rodar duas vezes não quebra nada.
--
-- Rodar como SUPERUSUÁRIO (`-U imobiliaria`), não como app_user: só o dono do
-- banco cria tabela e concede GRANT. O `atualizar-vps.sh` já faz isso.
-- ═════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Pessoas: telefone e e-mail deixam de ser únicos.
-- Barravam cadastro legítimo — marido e mulher com o mesmo celular, fiador que
-- repete o e-mail do inquilino. Só o CPF/CNPJ identifica a pessoa.
-- ─────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_persons_phone;
DROP INDEX IF EXISTS idx_persons_email;

-- ─────────────────────────────────────────────────────────────
-- Cobrança de condomínio (receivables.kind = 'CONDOMINIO').
-- ─────────────────────────────────────────────────────────────
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS condominium_id UUID;
CREATE INDEX IF NOT EXISTS idx_receivables_condominium
  ON receivables (condominium_id, competence)
  WHERE condominium_id IS NOT NULL;
-- Idempotência: um imóvel só é cobrado uma vez por competência. Cobrança
-- CANCELADA fica fora do índice de propósito — cancelar é como se corrige um
-- lote errado, e sem a exceção o período ficaria travado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_receivables_condo_charge
  ON receivables (tenant_id, property_id, competence)
  WHERE kind = 'CONDOMINIO' AND property_id IS NOT NULL AND competence IS NOT NULL
    AND status <> 'CANCELADO';

-- ═════════════════════════════════════════════════════════════════
-- MOD-FIN / Fluxo de caixa — comissões, categorias e lançamentos manuais.
--
-- O fluxo de caixa em si NÃO tem tabela: é um read model que compõe as origens
-- que já existem (`receivables`, `payables`) com as tabelas abaixo. Ganham
-- tabela só os fatos que não têm casa em lugar nenhum.
-- ═════════════════════════════════════════════════════════════════

-- ── Comissões (MOD-FIN-05) ───────────────────────────────────────
-- UMA LINHA POR PARTE: a comissão da imobiliária é receita e a do corretor é
-- despesa, em datas possivelmente diferentes. Guardar só o líquido apagaria a
-- despesa e faria a margem da venda parecer o valor cheio.
CREATE TABLE IF NOT EXISTS commissions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL DEFAULT 'VENDA',   -- VENDA|LOCACAO
  party                TEXT NOT NULL,                   -- IMOBILIARIA (receita) | CORRETOR (despesa)
  property_id          UUID,                            -- FK lógica → properties
  contract_id          UUID,                            -- FK lógica → contracts (comissão de locação)
  sale_id              UUID,                            -- FK lógica → sales
  broker_id            UUID,                            -- FK lógica → brokers (obrigatório se party=CORRETOR)
  description          TEXT,
  base_cents           BIGINT NOT NULL DEFAULT 0,       -- valor da venda (base do percentual)
  percent_snapshot     NUMERIC(5,2) NOT NULL DEFAULT 0, -- % congelado no fechamento (RN-04)
  amount_cents         BIGINT NOT NULL,                 -- valor da comissão desta parte
  due_date             DATE NOT NULL,
  status               TEXT NOT NULL DEFAULT 'ABERTO',  -- ABERTO|QUITADO|CANCELADO
  settled_at           DATE,                            -- data do caixa (recebimento ou pagamento)
  settled_amount_cents BIGINT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commissions_tenant_status ON commissions (tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_commissions_broker        ON commissions (tenant_id, broker_id, status);
-- O fluxo de caixa varre por data de quitação; sem este índice o mês vira seq
-- scan na tabela inteira à medida que o histórico cresce.
CREATE INDEX IF NOT EXISTS idx_commissions_settled       ON commissions (tenant_id, settled_at)
  WHERE status = 'QUITADO';
-- Idempotência do módulo de venda: reprocessar o fechamento não pode pagar o
-- corretor duas vezes. `NULLS NOT DISTINCT` (PG15+) é obrigatório: a parte da
-- IMOBILIARIA tem `broker_id` nulo, e no padrão dois nulos são distintos entre
-- si — o único deixaria passar uma segunda linha idêntica.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commissions_sale
  ON commissions (sale_id, party, broker_id) NULLS NOT DISTINCT
  WHERE sale_id IS NOT NULL;

ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON commissions;
CREATE POLICY tenant_isolation ON commissions
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON commissions TO app_user;

-- ── Categorias do lançamento manual ──────────────────────────────
-- Lookup por tenant. O onboarding não popula lookup nenhum; por isso
-- `cash_flow_entries.category_id` permite nulo — uma imobiliária recém criada
-- precisa lançar a primeira despesa antes de montar a lista.
CREATE TABLE IF NOT EXISTS cash_flow_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code       INTEGER NOT NULL DEFAULT 0,       -- sequencial por tenant
  name       TEXT NOT NULL,
  direction  TEXT NOT NULL,                    -- ENTRADA|SAIDA
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_flow_categories_tenant ON cash_flow_categories (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_flow_categories_code
  ON cash_flow_categories (tenant_id, code);

ALTER TABLE cash_flow_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flow_categories FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cash_flow_categories;
CREATE POLICY tenant_isolation ON cash_flow_categories
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON cash_flow_categories TO app_user;

-- ── Lançamento manual (receita/despesa avulsa) ───────────────────
-- O que o sistema não apura sozinho: aluguel do escritório, salário, tarifa.
-- Sem isto o fluxo de caixa só mostraria receita e nunca fecharia com o extrato.
CREATE TABLE IF NOT EXISTS cash_flow_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_date   DATE NOT NULL,
  direction    TEXT NOT NULL,                  -- ENTRADA|SAIDA
  category_id  UUID,                           -- FK lógica → cash_flow_categories (nulo = "Sem categoria")
  bank_id      UUID,                           -- FK lógica → banks
  amount_cents BIGINT NOT NULL,                -- sempre positivo; o sinal vem de `direction`
  description  TEXT NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_flow_entries_tenant_date
  ON cash_flow_entries (tenant_id, entry_date);

ALTER TABLE cash_flow_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flow_entries FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cash_flow_entries;
CREATE POLICY tenant_isolation ON cash_flow_entries
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON cash_flow_entries TO app_user;

-- ═════════════════════════════════════════════════════════════════
-- VENDA DE IMÓVEL (MOD-VENDA)
-- ═════════════════════════════════════════════════════════════════

-- ── Formas de pagamento (lookup) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_methods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        INTEGER NOT NULL DEFAULT 0,   -- Cód (sequencial por tenant)
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant ON payment_methods (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_methods_tenant_code
  ON payment_methods (tenant_id, code);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payment_methods;
CREATE POLICY tenant_isolation ON payment_methods
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_methods TO app_user;

-- ── Vendas ───────────────────────────────────────────────────────
-- Registrar a venda marca o imóvel como VENDIDO e alimenta `commissions` por
-- `sale_id` — o id desta tabela é a chave de idempotência que `commissions`
-- já esperava. Os dados do COMPRADOR são texto livre, e não FK para `persons`:
-- o que vai para a escritura é o que foi digitado no dia do fechamento.
CREATE TABLE IF NOT EXISTS sales (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                 INTEGER NOT NULL DEFAULT 0,  -- Nro/Cód (sequencial por tenant)
  property_id          UUID NOT NULL,               -- FK lógica → properties
  sold_at              DATE,                        -- data do fechamento
  -- Comprador
  buyer_name           TEXT NOT NULL,
  buyer_nationality    TEXT,
  buyer_marital_status TEXT,                        -- SOLTEIRO|CASADO|DIVORCIADO|VIUVO|UNIAO_ESTAVEL
  buyer_occupation     TEXT,                        -- Profissão
  buyer_address        TEXT,
  buyer_district       TEXT,
  buyer_city           TEXT,
  buyer_state          TEXT,
  buyer_zip            TEXT,
  buyer_cpf            TEXT,
  buyer_rg             TEXT,
  -- Cônjuge
  spouse_name          TEXT,
  spouse_nationality   TEXT,
  spouse_occupation    TEXT,
  spouse_cpf           TEXT,
  spouse_rg            TEXT,
  marriage_regime      TEXT,                        -- Regime de casamento (texto livre)
  -- Negócio
  payment_method_id    UUID,                        -- FK lógica → payment_methods
  payment_notes        TEXT,                        -- detalhamento (sinal, parcelas, banco)
  commission_percent   NUMERIC(5,2) NOT NULL DEFAULT 0, -- % sobre o valor da venda
  value_cents          BIGINT NOT NULL DEFAULT 0,   -- valor da venda
  broker_id            UUID,                        -- FK lógica → brokers
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_property ON sales (tenant_id, property_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_tenant_code ON sales (tenant_id, code);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales;
CREATE POLICY tenant_isolation ON sales
  USING       (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON sales TO app_user;

-- ─────────────────────────────────────────────────────────────
-- Seed do tenant demo, espelhando o `init.sql`. O `SELECT ... WHERE EXISTS`
-- (em vez do INSERT ... VALUES) é o que deixa o arquivo rodar num banco onde o
-- tenant demo não existe: sem ele a FK derruba a migração inteira.
-- ─────────────────────────────────────────────────────────────
INSERT INTO cash_flow_categories (tenant_id, code, name, direction)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, v.code, v.name, v.direction
FROM (VALUES
  (1, 'Aluguel do escritório',   'SAIDA'),
  (2, 'Salários e encargos',     'SAIDA'),
  (3, 'Tarifas bancárias',       'SAIDA'),
  (4, 'Marketing e publicidade', 'SAIDA'),
  (5, 'Impostos e taxas',        'SAIDA'),
  (6, 'Outras receitas',         'ENTRADA')
) AS v(code, name, direction)
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO payment_methods (tenant_id, code, name)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, v.code, v.name
FROM (VALUES
  (1, 'À vista'),
  (2, 'Financiado'),
  (3, 'Parcelado direto com o proprietário')
) AS v(code, name)
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = '00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

COMMIT;
