#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════
# Recupera o .env da stack a partir dos CONTAINERS EM EXECUÇÃO.
#
# Serve para quando o campo Environment do EasyPanel é sobrescrito por acidente
# (editar as tags da imagem e colar só elas, por exemplo). Enquanto os
# containers não forem recriados, o Docker ainda guarda os valores antigos em
# `.Config.Env` — esta é a janela de recuperação. Depois de um `up` bem
# sucedido com o ambiente errado, eles se perdem.
#
# Não imprime segredo na tela: grava em /root/.env.easypanel.recuperado (0600)
# e mostra só um resumo mascarado.
#
#   bash scripts/recuperar-env-easypanel.sh
# ═════════════════════════════════════════════════════════════════
set -euo pipefail

BE=${BE:-offices-ai-backend-1}
FE=${FE:-offices-ai-frontend-1}
PG=${PG:-offices-ai-postgres-1}
OUT=${OUT:-/root/.env.easypanel.recuperado}

for c in "$BE" "$FE" "$PG"; do
  docker inspect "$c" >/dev/null 2>&1 || { echo "ERRO: container '$c' não existe."; exit 1; }
  [ "$(docker inspect -f '{{.State.Running}}' "$c")" = "true" ] \
    || echo "AVISO: '$c' não está rodando — os valores ainda podem estar no Config.Env."
done

envof() { docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}'; }
get()   { grep -m1 "^$2=" <<<"$1" | cut -d= -f2- || true; }
label() { docker inspect "$1" --format "{{index .Config.Labels \"$2\"}}"; }

BEENV=$(envof "$BE"); FEENV=$(envof "$FE"); PGENV=$(envof "$PG")

# ── valores compostos: desmontar as URLs de volta nas peças do .env ──
DB_URL=$(get "$BEENV" DATABASE_URL)
RD_URL=$(get "$BEENV" REDIS_URL)
MQ_URL=$(get "$BEENV" RABBITMQ_URL)
CORS=$(get "$BEENV" CORS_ORIGIN)

APP_DB_PASSWORD=$(sed -E 's|^postgres://[^:]+:(.*)@postgres:[0-9]+/.*$|\1|' <<<"$DB_URL")
POSTGRES_DB=$(sed -E 's|^.*/([^/?]+)$|\1|'                                  <<<"$DB_URL")
REDIS_PASSWORD=$(sed -E 's|^redis://:(.*)@redis:[0-9]+.*$|\1|'              <<<"$RD_URL")
RABBITMQ_USER=$(sed -E 's|^amqp://([^:]+):.*$|\1|'                          <<<"$MQ_URL")
RABBITMQ_PASSWORD=$(sed -E 's|^amqp://[^:]+:(.*)@rabbitmq:[0-9]+.*$|\1|'    <<<"$MQ_URL")
APP_DOMAIN=${CORS#https://}

# ── STACK_DIR: sai do bind mount do init.sql no Postgres ──
STACK_DIR=$(docker inspect "$PG" \
  --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' \
  | grep -m1 '/infra/postgres/init.sql$' | sed 's|/infra/postgres/init.sql$||' || true)
STACK_DIR=${STACK_DIR:-$(pwd)}

umask 077
cat > "$OUT" <<EOF
APP_DOMAIN=$APP_DOMAIN
TRAEFIK_NETWORK=$(label "$FE" traefik.docker.network)
TRAEFIK_ENTRYPOINT=$(label "$FE" traefik.http.routers.offices-frontend.entrypoints)
TRAEFIK_CERTRESOLVER=$(label "$FE" traefik.http.routers.offices-frontend.tls.certresolver)
STACK_DIR=$STACK_DIR

BACKEND_IMAGE=${BACKEND_IMAGE:-ghcr.io/mariomoraes/offices-backend:0.2.0}
FRONTEND_IMAGE=${FRONTEND_IMAGE:-ghcr.io/mariomoraes/offices-frontend:0.2.0}

POSTGRES_USER=$(get "$PGENV" POSTGRES_USER)
POSTGRES_PASSWORD=$(get "$PGENV" POSTGRES_PASSWORD)
POSTGRES_DB=$POSTGRES_DB
APP_DB_PASSWORD=$APP_DB_PASSWORD
REDIS_PASSWORD=$REDIS_PASSWORD
RABBITMQ_USER=$RABBITMQ_USER
RABBITMQ_PASSWORD=$RABBITMQ_PASSWORD

APP_ENCRYPTION_KEY=$(get "$BEENV" APP_ENCRYPTION_KEY)

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$(get "$FEENV" NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
CLERK_SECRET_KEY=$(get "$BEENV" CLERK_SECRET_KEY)
CLERK_JWT_KEY=$(get "$BEENV" CLERK_JWT_KEY)
NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL=/onboarding
PLATFORM_ADMIN_CLERK_IDS=$(get "$BEENV" PLATFORM_ADMIN_CLERK_IDS)

S3_ENDPOINT=$(get "$BEENV" S3_ENDPOINT)
S3_REGION=$(get "$BEENV" S3_REGION)
S3_ACCESS_KEY=$(get "$BEENV" S3_ACCESS_KEY)
S3_SECRET_KEY=$(get "$BEENV" S3_SECRET_KEY)
S3_BUCKET=$(get "$BEENV" S3_BUCKET)
S3_FORCE_PATH_STYLE=$(get "$BEENV" S3_FORCE_PATH_STYLE)

RESEND_API_KEY=$(get "$BEENV" RESEND_API_KEY)
MAIL_FROM=$(get "$BEENV" MAIL_FROM)

LOG_LEVEL=$(get "$BEENV" LOG_LEVEL)
EOF
chmod 600 "$OUT"

# ── resumo mascarado: confere o que veio sem expor segredo ──
echo "Gravado em $OUT ($(grep -cE '^[A-Z_0-9]+=' "$OUT") variáveis)"
echo
while IFS='=' read -r k v; do
  case "$k" in ''|\#*) continue ;; esac
  case "$k" in
    *PASSWORD*|*SECRET*|*KEY*)
      [ -n "$v" ] && printf '  %-46s %s… (%d car.)\n' "$k" "${v:0:4}" "${#v}" \
                  || printf '  %-46s (VAZIO)\n' "$k" ;;
    *)
      [ -n "$v" ] && printf '  %-46s %s\n' "$k" "$v" \
                  || printf '  %-46s (VAZIO)\n' "$k" ;;
  esac
done < "$OUT"
echo
echo "Confira as linhas (VAZIO): variável vazia aqui é funcionalidade desligada."
