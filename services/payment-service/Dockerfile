FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/ ./packages/
COPY services/payment-service/ ./services/payment-service/
# Include compiled WASM if available
COPY contracts/target/wasm32-unknown-unknown/release/funti3r_soroban.wasm \
     ./contracts/target/wasm32-unknown-unknown/release/ 2>/dev/null || true

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @funti3r/shared-utils build
RUN pnpm --filter @funti3r/shared-types build || true
RUN pnpm --filter @funti3r/database build || true
RUN pnpm --filter @funti3r/payment-service build

FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/services/payment-service/dist/ ./services/payment-service/dist/
COPY --from=builder /app/services/payment-service/package.json ./services/payment-service/
COPY --from=builder /app/contracts/ ./contracts/ 2>/dev/null || true

RUN pnpm install --frozen-lockfile --prod

EXPOSE 3002
CMD ["node", "services/payment-service/dist/index.js"]
