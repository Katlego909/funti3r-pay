FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# tsconfig.json is required — the dashboard build runs `tsc && vite build`
# and apps/enterprise-dashboard/tsconfig.json extends the root one.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/ ./packages/
COPY apps/enterprise-dashboard/ ./apps/enterprise-dashboard/

# --ignore-scripts: the Stellar wallet deps pull in Ledger's native `usb` and
# `tiny-secp256k1`, which try to compile via node-gyp and fail on alpine. This
# is a static browser bundle — it uses WebUSB, never the native binaries — so
# the postinstall compiles are pure cost. esbuild/vite resolve their platform
# binary from the @esbuild/linux-x64 optional dep, which needs no postinstall.
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @funti3r/enterprise-dashboard build

# Serve with nginx
FROM nginx:alpine
COPY --from=builder /app/apps/enterprise-dashboard/dist /usr/share/nginx/html
COPY apps/enterprise-dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
