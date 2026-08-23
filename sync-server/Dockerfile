# Builds the sync-server image. Build context MUST be the REPO ROOT
# (the root pnpm-lock.yaml is the single source of truth for the whole
# workspace — see root .gitignore):
#
#   docker build -f sync-server/Dockerfile .
#
# Node major matches NODE_VERSION in .github/workflows/ci.yml;
# pnpm version matches "packageManager" in the root package.json.

# --- Stage 1 : build ---
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.10.0 --activate

WORKDIR /app

# Workspace manifests first so the filtered install is layer-cached
# independently of source changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY sync-server/package.json ./sync-server/
RUN pnpm install --frozen-lockfile --filter reqly-sync-server...

COPY sync-server/ ./sync-server/
RUN pnpm --filter reqly-sync-server build

# --- Stage 2 : prod-only deploy bundle ---
# Derived from builder: reuses its warm pnpm store and keeps python3/make/g++
# available in case better-sqlite3 has to rebuild from source here.
FROM builder AS prod-deps

RUN pnpm --filter reqly-sync-server deploy --prod /out

# --- Stage 3 : runner ---
# Clean slim base: no build toolchain reaches production. The deploy bundle
# already contains prod node_modules, so nothing is installed here.
FROM node:22-slim AS runner

RUN corepack enable && corepack prepare pnpm@11.10.0 --activate

WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /out/ ./
COPY --from=builder /app/sync-server/dist ./dist

EXPOSE 4000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
