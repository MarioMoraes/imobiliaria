# Backend — build multi-stage (SPEC seção 11.1), imagem final mínima.

# ── build ────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
# Instala deps do workspace do backend isoladamente.
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
