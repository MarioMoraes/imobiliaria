#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════
# Extrai os dados de UM tenant do banco local num arquivo carregável em outro
# ambiente (tipicamente: levar cadastros de demonstração para a VPS).
#
#   bash scripts/exportar-tenant.sh <tenant-id> [arquivo.sql]
#
# SÓ FUNCIONA SE O TENANT TIVER O MESMO UUID NOS DOIS BANCOS. O arquivo carrega
# as linhas com o `tenant_id` que elas já têm; num banco onde esse id não existe,
# os dados entram órfãos e nenhuma tela os mostra (o RLS filtra por
# `app.tenant_id`). Conferir antes:
#
#   SELECT id, name FROM tenants;   -- nos dois bancos
# ═════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

TENANT=${1:-}
if [ -z "$TENANT" ]; then
  echo "uso: bash scripts/exportar-tenant.sh <tenant-id> [arquivo.sql]" >&2
  exit 1
fi
SAIDA=${2:-tenant-${TENANT:0:8}.sql}
PG=${PG:-imobiliaria-postgres}
DB=${DB:-imobiliaria}

# Superusuário, não `app_user`: quem lê ignorando o RLS e quem desliga os
# gatilhos de FK na carga é o dono do banco.
psql_() { docker exec -i "$PG" psql -U imobiliaria -d "$DB" "$@"; }

if ! psql_ -tAc "SELECT 1 FROM tenants WHERE id='$TENANT';" | grep -q 1; then
  echo "ERRO: tenant $TENANT não existe em $PG/$DB." >&2
  exit 1
fi

# Fora da lista, de propósito:
#   users, user_roles, tenants     identidade — o destino já tem a sua, e
#                                  duplicar quebra o vínculo com o Clerk;
#   tenant_payment_settings,       `api_key_enc` é cifrada com a chave DO
#   tenant_signature_settings      ambiente: copiada, vira lixo indecifrável;
#   audit_logs                     trilha imutável, local a cada ambiente;
#   agent_*, rag_*                 histórico do copiloto e índice, se refazem;
#   asaas_*, ai_credits            apontam para cobrança/consumo reais no provedor.
TABELAS=(
  districts events property_types inspection_items payment_methods
  cash_flow_categories banks brokers clauses contract_templates employees
  condominiums
  persons person_addresses person_search_profiles person_interactions
  properties property_photos property_owners property_inspections
  property_inspection_entries
  contracts contract_parties contract_versions contract_signature_envelopes
  contract_signature_signers
  receivables payables commissions sales cash_flow_entries condominium_expenses
  documents document_versions
)

{
  echo "-- Dados do tenant $TENANT"
  echo "-- Gerado por scripts/exportar-tenant.sh em $(date +%F' '%H:%M)."
  echo "BEGIN;"
  # Com os gatilhos de FK desligados a ordem das tabelas deixa de importar —
  # `contract_parties` pode entrar antes de `contracts`. A alternativa seria
  # ordenar 33 tabelas por dependência e reordenar a cada tabela nova.
  echo "SET session_replication_role = replica;"
  # Recarga limpa: sem o DELETE, rodar duas vezes duplicaria tudo o que não tem
  # índice único.
  for t in "${TABELAS[@]}"; do
    echo "DELETE FROM public.$t WHERE tenant_id = '$TENANT';"
  done
} > "$SAIDA"

TOTAL=0
for t in "${TABELAS[@]}"; do
  n=$(psql_ -tAc "SELECT count(*) FROM public.$t WHERE tenant_id='$TENANT';" | tr -d '[:space:]')
  [ "$n" = "0" ] && continue
  # As colunas vão explícitas no COPY: assim o arquivo continua carregável num
  # banco onde uma coluna foi adicionada depois (a ordem do `SELECT *` mudaria).
  cols=$(psql_ -tAc "SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
                       FROM pg_attribute
                      WHERE attrelid='public.$t'::regclass
                        AND attnum > 0 AND NOT attisdropped;" | tr -d '\r')
  {
    echo
    echo "COPY public.$t ($cols) FROM stdin;"
  } >> "$SAIDA"
  # `\copy ... TO STDOUT` emite exatamente o formato que o `COPY ... FROM stdin`
  # acima espera (tab-separado, \N para nulo).
  psql_ -q -c "\copy (SELECT $cols FROM public.$t WHERE tenant_id='$TENANT') TO STDOUT" >> "$SAIDA"
  echo '\.' >> "$SAIDA"
  printf '   %-30s %5s linhas\n' "$t" "$n" >&2
  TOTAL=$((TOTAL + n))
done

{
  echo
  echo "SET session_replication_role = DEFAULT;"
  echo "COMMIT;"
} >> "$SAIDA"

echo >&2
echo "✓ $SAIDA — $TOTAL linhas" >&2
echo >&2
echo "Antes de mandar para a VPS, valide carregando de volta AQUI (o arquivo é" >&2
echo "idempotente: apaga o tenant e recarrega), para a sintaxe não estrear em" >&2
echo "produção:" >&2
echo "    docker exec -i $PG psql -U imobiliaria -d $DB -v ON_ERROR_STOP=1 -q < $SAIDA" >&2
echo >&2
echo "Depois:" >&2
echo "    scp $SAIDA root@IP_DA_VPS:/root/" >&2
echo "    docker exec -i offices-ai-postgres-1 psql -U imobiliaria -d imobiliaria -v ON_ERROR_STOP=1 -q < /root/$(basename "$SAIDA")" >&2
