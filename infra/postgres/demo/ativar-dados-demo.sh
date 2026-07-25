#!/bin/sh
# Transfere os dados de exemplo para a imobiliária que o cliente acabou de criar.
#
# Contexto: o onboarding cria o tenant vazio — sem tipos de imóvel, bairros,
# cláusulas nem contratos-modelo. Numa demonstração isso aparece como um sistema
# "quebrado", quando na verdade é só um cadastro novo. Este script resolve isso
# entregando o acervo de exemplo do `init.sql` para o tenant recém-criado.
#
# Por que MOVER (UPDATE tenant_id) em vez de copiar: as chaves estrangeiras são
# todas por `id`, e nenhuma é composta com `tenant_id` (conferido no schema).
# Mudar só o dono preserva imóvel↔proprietário, contrato↔parcelas e todo o resto
# sem reescrever id nenhum. Copiar exigiria remapear cada FK — mais código e mais
# chance de sair um vínculo errado no meio da demonstração.
#
# Uso (na máquina onde a demo está rodando), DEPOIS de criar a conta no sistema:
#   docker compose -f docker-compose.demo.yml exec postgres /demo/ativar-dados-demo.sh
set -e

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-imobiliaria}" \
     --dbname "${POSTGRES_DB:-imobiliaria}" <<'EOSQL'
DO $$
DECLARE
  tenant_demo CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  alvo   uuid;
  nome   text;
  t      record;
  linhas bigint;
  total  bigint := 0;
BEGIN
  -- A imobiliária do cliente é a mais recente que não seja a do seed.
  SELECT id, name INTO alvo, nome
    FROM tenants
   WHERE id <> tenant_demo
   ORDER BY created_at DESC
   LIMIT 1;

  IF alvo IS NULL THEN
    RAISE EXCEPTION USING MESSAGE =
      'Nenhuma imobiliária cadastrada ainda. Crie a conta em http://localhost:3000 e rode este comando depois.';
  END IF;

  -- A lista de tabelas é descoberta no catálogo, não fixada aqui: um módulo novo
  -- passa a ser incluído sozinho, sem alguém lembrar de editar este script.
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       -- Exclusões deliberadas:
       --  users/user_roles/employees → identidade. Os usuários do seed são de
       --    outra conta do Clerk; movê-los para o tenant do cliente criaria
       --    "funcionários" que ninguém consegue usar.
       --  tenant_*_settings → credenciais de ZapSign/Asaas, cifradas com a
       --    chave da instalação de origem: no destino seriam ilegíveis.
       --  asaas_* → estado de cobrança do provedor, sem sentido fora da conta
       --    que o gerou.
       AND c.relname NOT IN (
         'users', 'user_roles', 'employees',
         'tenant_payment_settings', 'tenant_signature_settings',
         'asaas_customers', 'asaas_webhook_events'
       )
     ORDER BY c.relname
  LOOP
    EXECUTE format('UPDATE %I SET tenant_id = $1 WHERE tenant_id = $2', t.relname)
      USING alvo, tenant_demo;
    GET DIAGNOSTICS linhas = ROW_COUNT;
    IF linhas > 0 THEN
      RAISE NOTICE '  % → % registro(s)', rpad(t.relname, 28), linhas;
      total := total + linhas;
    END IF;
  END LOOP;

  IF total = 0 THEN
    RAISE NOTICE 'Nada a transferir: os dados de exemplo já foram entregues antes.';
  ELSE
    RAISE NOTICE '% registro(s) agora pertencem a "%".', total, nome;
    RAISE NOTICE 'Recarregue o navegador para vê-los.';
  END IF;
END $$;
EOSQL
