FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.json ./
COPY packages/ ./packages/
COPY services/payment-service/ ./services/payment-service/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @funti3r/shared-types build
RUN pnpm --filter @funti3r/shared-utils build
RUN pnpm --filter @funti3r/database build
RUN pnpm --filter @funti3r/payment-service build

FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/services/payment-service/dist/ ./services/payment-service/dist/
COPY --from=builder /app/services/payment-service/package.json ./services/payment-service/
# runInitialMigrations() reads these at boot, resolved relative to dist/
COPY services/database/migrations/ ./services/database/migrations/

RUN pnpm install --frozen-lockfile --prod

EXPOSE 3002
# --conditions=production makes @funti3r/* resolve to compiled dist instead of TS source
CMD ["node", "--conditions=production", "services/payment-service/dist/index.js"]
