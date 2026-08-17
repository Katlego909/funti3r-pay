FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.json ./
COPY packages/ ./packages/
COPY services/user-service/ ./services/user-service/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @funti3r/shared-types build
RUN pnpm --filter @funti3r/shared-utils build
RUN pnpm --filter @funti3r/database build
RUN pnpm --filter @funti3r/user-service build

FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/services/user-service/dist/ ./services/user-service/dist/
COPY --from=builder /app/services/user-service/package.json ./services/user-service/
# runInitialMigrations() reads these at boot, resolved relative to dist/
COPY services/database/migrations/ ./services/database/migrations/

RUN pnpm install --frozen-lockfile --prod

EXPOSE 3001
# --conditions=production makes @funti3r/* resolve to compiled dist instead of TS source
CMD ["node", "--conditions=production", "services/user-service/dist/index.js"]
