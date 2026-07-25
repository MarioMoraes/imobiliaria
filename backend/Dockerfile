# Backend — build multi-stage (SPEC seção 11.1), imagem final mínima.
#
# ATENÇÃO: o contexto de build é a RAIZ do monorepo, não `backend/`:
#   docker build -f backend/Dockerfile -t offices-ai/backend .
# É o `package-lock.json` da raiz que fixa as versões instaladas em dev e
# testadas no CI — construir a partir de `backend/` obrigaria a um `npm install`
# sem lock, que resolve versões novas na hora do deploy (a imagem que sobe deixa
# de ser a que foi testada).

# ── build ────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /repo
# As camadas de dependência vêm antes do código: enquanto os manifestos não
# mudam, o Docker reaproveita o `npm ci` inteiro entre builds.
# O `npm ci` valida o lock contra TODOS os workspaces, então o package.json do
# frontend precisa existir mesmo sem instalar as deps dele.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace=backend --include-workspace-root

COPY backend/tsconfig.json backend/
COPY backend/src backend/src
RUN npm run build --workspace=backend

# ── deps de runtime ──────────────────────────────────────────────
# Instalação separada com --omit=dev: a árvore de produção não pode carregar
# typescript/tsx/eslint para dentro da imagem final.
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace=backend --include-workspace-root --omit=dev \
 && npm cache clean --force

# ── runtime ──────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# `wget` (do busybox) já vem no alpine e é o que o healthcheck do compose usa.
WORKDIR /app

# O layout de workspace é preservado de propósito: o npm iça as dependências
# para a raiz (`/app/node_modules`), e é subindo a árvore que o Node as acha a
# partir de `/app/backend`. Achatar isso quebraria a resolução.
COPY --from=deps  /repo/node_modules ./node_modules
COPY --from=deps  /repo/package.json ./package.json
COPY --from=deps  /repo/backend/package.json ./backend/package.json
COPY --from=build /repo/backend/dist ./backend/dist

# Usuário sem privilégios (já existe na imagem oficial). Um RCE no processo não
# pode reescrever a própria aplicação.
USER node

WORKDIR /app/backend
EXPOSE 3001
CMD ["node", "dist/index.js"]
