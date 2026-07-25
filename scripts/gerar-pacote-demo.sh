#!/usr/bin/env bash
# Gera o pacote de demonstração para o cliente rodar no Docker Desktop dele.
#
#   ./scripts/gerar-pacote-demo.sh              # imagens da aplicação (~400 MB)
#   ./scripts/gerar-pacote-demo.sh --completo   # + postgres/redis/rabbit/gotenberg
#
# Sem --completo, a primeira execução na máquina do cliente baixa quatro imagens
# públicas do Docker Hub (não exige conta). Use --completo quando a demonstração
# for em local sem internet confiável: o pacote passa de ~400 MB para ~1,2 GB e
# nada é baixado na hora.
set -euo pipefail

cd "$(dirname "$0")/.."
RAIZ="$PWD"
COMPLETO=false
[[ "${1:-}" == "--completo" ]] && COMPLETO=true

if [[ ! -f .env.demo ]]; then
  echo "ERRO: .env.demo não existe. Rode: cp .env.demo.example .env.demo (e preencha as chaves do Clerk)" >&2
  exit 1
fi

set -a; source .env.demo; set +a

: "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:?defina no .env.demo}"
: "${CLERK_SECRET_KEY:?defina no .env.demo}"
if [[ "$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" == pk_test_xxx || "$CLERK_SECRET_KEY" == sk_test_xxx ]]; then
  echo "ERRO: as chaves do Clerk no .env.demo ainda são os placeholders do exemplo." >&2
  exit 1
fi

BACKEND_IMAGE="${BACKEND_IMAGE:-offices-ai/backend:demo}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-offices-ai/frontend:demo}"

# Uma chave por pacote: dois clientes diferentes não compartilham a chave que
# cifra os tokens de integração. Gerar aqui evita a de desenvolvimento
# (versionada no repositório) vazar para dentro de uma entrega.
if [[ -z "${APP_ENCRYPTION_KEY:-}" ]]; then
  APP_ENCRYPTION_KEY="$(openssl rand -base64 32)"
fi

DATA="$(date +%Y-%m-%d)"
SAIDA="$RAIZ/dist/demo"
PACOTE="offices-ai-demo-$DATA"
rm -rf "$SAIDA"
mkdir -p "$SAIDA/$PACOTE/infra/postgres/prod" "$SAIDA/$PACOTE/infra/postgres/demo"

echo "▸ construindo backend  ($BACKEND_IMAGE)"
docker build -q -f backend/Dockerfile -t "$BACKEND_IMAGE" . >/dev/null

echo "▸ construindo frontend ($FRONTEND_IMAGE)"
# A chave publicável do Clerk é assada no bundle do navegador — por isso ela é
# argumento de BUILD e não variável de runtime (ver frontend/Dockerfile).
docker build -q -f frontend/Dockerfile \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" \
  -t "$FRONTEND_IMAGE" . >/dev/null

IMAGENS=("$BACKEND_IMAGE" "$FRONTEND_IMAGE")
if $COMPLETO; then
  IMAGENS+=(postgres:16-alpine redis:7-alpine rabbitmq:3-alpine gotenberg/gotenberg:8)
  echo "▸ baixando as imagens de apoio (pacote completo)"
  for img in postgres:16-alpine redis:7-alpine rabbitmq:3-alpine gotenberg/gotenberg:8; do
    docker pull -q "$img" >/dev/null
  done
fi

echo "▸ exportando ${#IMAGENS[@]} imagem(ns) — leva alguns minutos"
docker save "${IMAGENS[@]}" | gzip -1 > "$SAIDA/$PACOTE/imagens.tar.gz"

cp docker-compose.demo.yml                     "$SAIDA/$PACOTE/"
cp infra/postgres/init.sql                     "$SAIDA/$PACOTE/infra/postgres/"
cp infra/postgres/prod/20-app-user-password.sh "$SAIDA/$PACOTE/infra/postgres/prod/"
cp infra/postgres/demo/ativar-dados-demo.sh    "$SAIDA/$PACOTE/infra/postgres/demo/"
cp docs/README-DEMO.md                         "$SAIDA/$PACOTE/LEIA-ME.md"

# `.env` (sem sufixo) é lido automaticamente pelo compose: o cliente não precisa
# passar --env-file nem editar nada.
cat > "$SAIDA/$PACOTE/.env" <<EOF
BACKEND_IMAGE=$BACKEND_IMAGE
FRONTEND_IMAGE=$FRONTEND_IMAGE
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY=$CLERK_SECRET_KEY
PLATFORM_ADMIN_CLERK_IDS=${PLATFORM_ADMIN_CLERK_IDS:-}
APP_ENCRYPTION_KEY=$APP_ENCRYPTION_KEY
S3_ENDPOINT=${S3_ENDPOINT:-}
S3_REGION=${S3_REGION:-auto}
S3_ACCESS_KEY=${S3_ACCESS_KEY:-}
S3_SECRET_KEY=${S3_SECRET_KEY:-}
S3_BUCKET=${S3_BUCKET:-imobiliaria-media}
S3_FORCE_PATH_STYLE=${S3_FORCE_PATH_STYLE:-true}
EOF

cd "$SAIDA"
tar czf "$PACOTE.tar.gz" "$PACOTE"
TAMANHO="$(du -h "$PACOTE.tar.gz" | cut -f1)"

echo
echo "pacote pronto: dist/demo/$PACOTE.tar.gz  ($TAMANHO)"
echo "entregue esse arquivo ao cliente — as instruções dele estão no LEIA-ME.md de dentro."
$COMPLETO || echo "(pacote leve: a primeira execução na máquina do cliente baixa 4 imagens públicas)"
