#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════
# PASSO 2 do deploy — roda na VPS, dentro de /opt/offices.
#
#   cd /opt/offices && bash scripts/atualizar-vps.sh 0.3.0
#
# Faz, nesta ordem: atualiza o código, aplica as migrações pendentes,
# puxa as imagens da versão e recria os containers. Para no primeiro erro.
#
# O project name `-p offices-ai` é obrigatório e não é decoração: é o que faz o
# compose RECONHECER os containers que já existem. Com outro nome ele sobe uma
# stack paralela com banco vazio, e o domínio passa a ser sorteado entre as duas.
# ═════════════════════════════════════════════════════════════════
set -euo pipefail

DIR=${DIR:-/opt/offices}
PROJETO=offices-ai
COMPOSE="docker compose -f docker-compose.easypanel.yml -p $PROJETO --env-file .env"
PG=${PG:-offices-ai-postgres-1}

VERSAO=${1:-}
if [ -z "$VERSAO" ]; then
  echo "uso: bash scripts/atualizar-vps.sh <versao>   (ex.: 0.3.0)" >&2
  exit 1
fi

cd "$DIR"
[ -f .env ] || { echo "ERRO: $DIR/.env não existe. É ele que guarda todo o ambiente." >&2; exit 1; }

psql_() { docker exec -i "$PG" psql -U imobiliaria -d imobiliaria "$@"; }

# ── 1. código ────────────────────────────────────────────────────
echo "→ atualizando o código"
git pull --ff-only

# ── 2. backup do banco ───────────────────────────────────────────
# Antes de qualquer DDL. Sem -t no docker exec: o pseudo-terminal insere \r e
# corrompe o dump silenciosamente — o arquivo existe e não presta.
BACKUP="/root/backup-$(date +%F-%H%M).sql.gz"
echo "→ backup em $BACKUP"
docker exec "$PG" pg_dump -U imobiliaria imobiliaria | gzip > "$BACKUP"
[ -s "$BACKUP" ] || { echo "ERRO: backup vazio. Abortando." >&2; exit 1; }

# ── 3. migrações pendentes ───────────────────────────────────────
# `init.sql` SÓ roda na criação do volume: num banco que já existe, mudança de
# schema tem de vir de um arquivo em infra/postgres/migrations/. O controle do
# que já rodou fica no próprio banco, para o script ser seguro de repetir.
echo "→ migrações"
psql_ -q -v ON_ERROR_STOP=1 -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );" >/dev/null

PENDENTES=0
for arquivo in $(ls -1 infra/postgres/migrations/*.sql 2>/dev/null | sort); do
  nome=$(basename "$arquivo")
  ja=$(psql_ -tAq -c "SELECT 1 FROM schema_migrations WHERE filename='$nome';")
  if [ -n "$ja" ]; then
    continue
  fi
  echo "   aplicando $nome"
  psql_ -q -v ON_ERROR_STOP=1 < "$arquivo"
  psql_ -q -c "INSERT INTO schema_migrations (filename) VALUES ('$nome');" >/dev/null
  PENDENTES=$((PENDENTES + 1))
done
[ "$PENDENTES" = "0" ] && echo "   nenhuma pendente"

# ── 4. imagens ───────────────────────────────────────────────────
echo "→ apontando o .env para a versão $VERSAO"
sed -i "s|^BACKEND_IMAGE=.*|BACKEND_IMAGE=ghcr.io/mariomoraes/offices-backend:$VERSAO|" .env
sed -i "s|^FRONTEND_IMAGE=.*|FRONTEND_IMAGE=ghcr.io/mariomoraes/offices-frontend:$VERSAO|" .env

echo "→ puxando as imagens"
$COMPOSE pull backend frontend

echo "→ recriando os containers"
$COMPOSE up -d

# ── 5. verificação ───────────────────────────────────────────────
echo "→ verificando"
DOMINIO=$(grep -m1 '^APP_DOMAIN=' .env | cut -d= -f2-)
sleep 5
docker ps --format '{{.Names}}  |  {{.Image}}' | grep "$PROJETO"
echo
if curl -fsS "https://$DOMINIO/health" >/dev/null; then
  echo "✓ https://$DOMINIO/health respondeu OK"
else
  echo "⚠ /health não respondeu. Veja: docker logs --tail 50 ${PROJETO}-backend-1"
  exit 1
fi
