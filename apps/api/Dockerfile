# MoveOS API — imagen de producción (monorepo pnpm)
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
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
# Ejecuta migraciones/esquema y arranca la API.
CMD ["sh", "-c", "pnpm --filter @moveos/api db:push && pnpm --filter @moveos/api start"]
