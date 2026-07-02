FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace files needed for pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/enterprise-dashboard/ ./apps/enterprise-dashboard/

RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @funti3r/enterprise-dashboard build

# Serve with nginx
FROM nginx:alpine
COPY --from=builder /app/apps/enterprise-dashboard/dist /usr/share/nginx/html
COPY apps/enterprise-dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
