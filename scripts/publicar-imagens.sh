#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════
# PASSO 1 do deploy — roda na SUA MÁQUINA (Mac).
#
# Constrói e publica as imagens no ghcr.io com a versão informada.
#
#   bash scripts/publicar-imagens.sh 0.3.0
#
# Depois disso, o passo 2 roda na VPS (ver docs/ATUALIZAR-VPS.md).
# ═════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

VERSAO=${1:-}
if [ -z "$VERSAO" ]; then
  echo "uso: bash scripts/publicar-imagens.sh <versao>   (ex.: 0.3.0)" >&2
  exit 1
fi

BACKEND_IMAGE="ghcr.io/mariomoraes/offices-backend:$VERSAO"
FRONTEND_IMAGE="ghcr.io/mariomoraes/offices-frontend:$VERSAO"

# A chave publicável do Clerk é ASSADA no bundle do navegador durante o build —
# trocá-la depois, no ambiente do container, não tem efeito nenhum. Por isso ela
# é lida aqui e não na VPS. Precisa ser a MESMA que está no .env da VPS.
PK=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-$(grep -m1 '^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=' .env.easypanel 2>/dev/null | cut -d= -f2-)}
if [ -z "${PK:-}" ]; then
  echo "ERRO: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY não encontrada." >&2
  echo "      Defina na variável de ambiente ou em .env.easypanel." >&2
  exit 1
fi

# Trabalho sujo não vai para produção: uma imagem construída de um working tree
# sujo não corresponde a nenhum commit, e depois não há como saber o que subiu.
if [ -n "$(git status --porcelain)" ]; then
  echo "ERRO: há alterações não commitadas. Commite (ou guarde) antes de publicar." >&2
  git status --short >&2
  exit 1
fi

if [ -n "$(git log '@{u}..HEAD' --oneline 2>/dev/null)" ]; then
  echo "ERRO: há commits locais não enviados. Rode 'git push' antes." >&2
  echo "      A VPS puxa o compose e as migrações do GitHub, não da sua máquina." >&2
  exit 1
fi

echo "→ construindo $BACKEND_IMAGE"
docker build -f backend/Dockerfile -t "$BACKEND_IMAGE" .

echo "→ construindo $FRONTEND_IMAGE"
docker build -f frontend/Dockerfile \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$PK" \
  -t "$FRONTEND_IMAGE" .

echo "→ publicando no ghcr.io"
docker push "$BACKEND_IMAGE"
docker push "$FRONTEND_IMAGE"

# Se o init.sql mudou desde a versão anterior e nenhuma migração nova foi
# adicionada, o banco da VPS vai ficar sem as tabelas novas — e o erro só
# aparece na tela do usuário, como "tabela inexistente". Avisar aqui é a única
# chance de perceber antes de subir.
ULTIMA_TAG=$(git tag --list 'v*' --sort=-v:refname | head -1)
if [ -n "$ULTIMA_TAG" ]; then
  if ! git diff --quiet "$ULTIMA_TAG..HEAD" -- infra/postgres/init.sql; then
    NOVAS=$(git diff --name-only "$ULTIMA_TAG..HEAD" -- infra/postgres/migrations/ | wc -l | tr -d ' ')
    if [ "$NOVAS" = "0" ]; then
      echo
      echo "⚠  ATENÇÃO: infra/postgres/init.sql mudou desde $ULTIMA_TAG, mas nenhuma"
      echo "   migração foi adicionada em infra/postgres/migrations/."
      echo "   O banco da VPS NÃO recebe mudanças de init.sql (ele só roda na"
      echo "   criação do volume). Escreva o delta antes de atualizar a VPS."
      echo
    fi
  fi
fi

# A tag marca qual commit virou qual versão — é dela que sai a comparação de
# schema na próxima publicação.
if git rev-parse "v$VERSAO" >/dev/null 2>&1; then
  echo "(tag v$VERSAO já existe, mantida)"
else
  git tag "v$VERSAO"
  git push -q origin "v$VERSAO"
fi

echo
echo "✓ publicado. Agora, na VPS:"
echo "    cd /opt/offices && bash scripts/atualizar-vps.sh $VERSAO"
