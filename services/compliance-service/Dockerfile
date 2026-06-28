FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/ ./packages/
COPY services/compliance-service/ ./services/compliance-service/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @funti3r/shared-utils build
RUN pnpm --filter @funti3r/shared-types build || true
RUN pnpm --filter @funti3r/database build || true
RUN pnpm --filter @funti3r/compliance-service build

FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/services/compliance-service/dist/ ./services/compliance-service/dist/
COPY --from=builder /app/services/compliance-service/package.json ./services/compliance-service/

RUN pnpm install --frozen-lockfile --prod

EXPOSE 3003
CMD ["node", "services/compliance-service/dist/index.js"]
