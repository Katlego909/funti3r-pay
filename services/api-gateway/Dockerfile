FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.json ./
COPY packages/ ./packages/
COPY services/api-gateway/ ./services/api-gateway/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @funti3r/shared-types build
RUN pnpm --filter @funti3r/shared-utils build
RUN pnpm --filter @funti3r/database build
RUN pnpm --filter @funti3r/api-gateway build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/services/api-gateway/dist/ ./services/api-gateway/dist/
COPY --from=builder /app/services/api-gateway/package.json ./services/api-gateway/

RUN pnpm install --frozen-lockfile --prod

EXPOSE 3000
# --conditions=production makes @funti3r/* resolve to compiled dist instead of TS source
CMD ["node", "--conditions=production", "services/api-gateway/dist/index.js"]
