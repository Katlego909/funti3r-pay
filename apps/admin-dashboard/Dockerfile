FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# tsconfig.json is required — the admin build runs `tsc && vite build`
# and apps/admin-dashboard/tsconfig.json extends the root one.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/ ./packages/
COPY apps/admin-dashboard/ ./apps/admin-dashboard/

# --ignore-scripts: this is a static browser bundle, so no dependency needs an install-time script, and skipping them
# keeps a compromised package from running code on the build machine. esbuild/vite resolve their platform binary from
# the @esbuild/linux-x64 optional dep, which needs no postinstall.
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @funti3r/admin-dashboard build

# Serve with nginx (unprivileged image: listens on 8080 as a non-root user)
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=builder /app/apps/admin-dashboard/dist /usr/share/nginx/html
COPY apps/admin-dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/admin-dashboard/security-headers.inc /etc/nginx/conf.d/security-headers.inc
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
