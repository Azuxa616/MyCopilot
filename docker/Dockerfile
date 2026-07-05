# Stage 1: deps
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Stage 2: build
FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable pnpm
RUN pnpm --filter @my-copilot/shared build
RUN pnpm --filter @my-copilot/web build

# Stage 3: runner
FROM node:20-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN groupadd -r app && useradd -r -g app app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.json ./
RUN mkdir -p /app/data && chown -R app:app /app
USER app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV SERVER_PUBLIC_DIR=/app/apps/web/dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1
CMD ["npx", "tsx", "apps/server/src/index.ts"]
