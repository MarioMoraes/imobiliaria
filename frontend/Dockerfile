# Frontend — build multi-stage (Next.js `output: standalone`).
#
# Contexto de build = RAIZ do monorepo (mesma razão do backend/Dockerfile):
#   docker build -f frontend/Dockerfile -t offices-ai/frontend .

# ── build ────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm ci --workspace=frontend --include-workspace-root

COPY frontend frontend/

# A chave PUBLICÁVEL do Clerk é lida pelo bundle do NAVEGADOR, então o Next a
# assa no JavaScript durante o build — não adianta injetá-la só no `docker run`.
# Por isso ela é ARG, e não apenas env de runtime: uma imagem construída sem ela
# sobe e falha no login. Não é segredo (é a `pk_...`, pública por definição); o
# segredo é o CLERK_SECRET_KEY, esse sim só em runtime.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
# Mesma regra para o destino pós-cadastro: é `NEXT_PUBLIC_`, logo é assado no
# bundle. Apontar para localhost aqui manda o cliente da demo para a sua máquina.
ARG NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL=/onboarding
ENV NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL=${NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL}

RUN npm run build --workspace=frontend

# ── runtime ──────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    # Sem HOSTNAME=0.0.0.0 o server.js escuta só em localhost DENTRO do
    # container — de fora (Caddy, outro serviço do compose) a porta parece morta.
    HOSTNAME=0.0.0.0
WORKDIR /app

# `output: standalone` já traz um node_modules podado com o necessário para
# servir — não se roda `npm install` aqui. Como o build é de monorepo
# (`outputFileTracingRoot` na raiz), o servidor sai em `frontend/server.js`.
COPY --from=build /repo/frontend/.next/standalone ./
# Os assets estáticos e o `public/` ficam FORA do standalone por design do Next
# (a ideia é servi-los por CDN). Sem esta cópia o app sobe sem CSS nem JS.
COPY --from=build /repo/frontend/.next/static ./frontend/.next/static

USER node

EXPOSE 3000
CMD ["node", "frontend/server.js"]
