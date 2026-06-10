# MoveOS API — imagen de producción (monorepo pnpm)
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# OpenSSL es requerido por el motor de Prisma; la imagen slim no lo trae.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Instalar dependencias del workspace (cacheable).
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/optimizer/package.json packages/optimizer/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

# Generar el cliente Prisma y construir.
FROM deps AS build
COPY . .
RUN pnpm --filter @moveos/api db:generate

# Imagen final.
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
# Aplica migraciones versionadas (no destructivo) y arranca la API.
# Antes usaba `db push` (peligroso en prod: podía recrear/soltar constraints).
CMD ["sh", "-c", "pnpm --filter @moveos/api db:migrate:deploy && pnpm --filter @moveos/api start"]
