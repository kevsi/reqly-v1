# --- Stage 1 : build ---
FROM node:22-slim AS builder

# tree-sitter-* (reqy-web) recompile des bindings natifs au "pnpm install"
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Lockfile régénéré en local avec pnpm 11 — rester aligné (pnpm@9
# déclenche ERR_PNPM_LOCKFILE_CONFIG_MISMATCH sur les overrides)
RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /app

# Workspace monorepo — on copie les package.json de TOUS les membres pour
# que pnpm résolve le graphe du workspace (pnpm-workspace.yaml liste
# reqy-web, recli, sync-server et packages/*).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY reqy-web/package.json reqy-web/package.json
COPY recli/package.json recli/package.json
COPY sync-server/package.json sync-server/package.json

# Install complet du workspace : @reqly/shared a besoin de ses devDeps
# (@types/node) pour compiler ; le filter `--filter reqly...` les omettait
# et faisait échouer le tsc de shared (TS2580: Cannot find name 'process').
# --frozen-lockfile : lockfile racine du monorepo.
RUN pnpm install --frozen-lockfile

# Source de @reqly/shared puis build (tsc -> dist)
COPY packages/shared packages/shared
RUN pnpm --filter @reqly/shared build

# Source de reqy-web puis build Next.js (webpack, pas turbopack)
COPY reqy-web reqy-web

ARG NEXT_PUBLIC_SYNC_URL
# AUTH_SIGNING_SECRET is a runtime secret — never pass as a build-arg.
# Inject it at container runtime via: docker run -e AUTH_SIGNING_SECRET=...
# (or via Fly secrets / k8s secrets). NEXT_PUBLIC_* vars ARE needed at
# build-time because Next.js inlines them into the client bundle.
ENV NEXT_PUBLIC_SYNC_URL=$NEXT_PUBLIC_SYNC_URL \
    NODE_ENV=production

# Build Next.js (webpack, pas turbopack). On appelle directement le script
# de reqy-web via --dir : `--filter reqly` matcherait aussi le package
# racine (même nom "reqly") et déclencherait turbo, qui exige un champ
# packageManager absent ici.
RUN pnpm --dir reqy-web build

# --- Stage 2 : production ---
FROM node:22-slim AS runner

# Runtime only: no C++ toolchain needed (bindings pre-built in builder stage)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11 --activate

WORKDIR /app
ENV NODE_ENV=production

# node_modules complet (deps + devDeps) : next.config.mjs importe
# @next/bundle-analyzer (devDep) au chargement, donc pas de --prod.
COPY --from=builder /app/node_modules ./node_modules
# pnpm place les .bin exécutables (next, etc.) dans node_modules du package
# lui-même (/app/reqy-web/node_modules/.bin) via des symlinks vers le store
# .pnpm — sans ça `pnpm start` ne trouve pas `next`.
COPY --from=builder /app/reqy-web/node_modules ./reqy-web/node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Artefacts de build de reqy-web
COPY --from=builder /app/reqy-web/.next ./reqy-web/.next
COPY --from=builder /app/reqy-web/public ./reqy-web/public
COPY --from=builder /app/reqy-web/next.config.mjs ./reqy-web/next.config.mjs
COPY --from=builder /app/reqy-web/package.json ./reqy-web/package.json

WORKDIR /app/reqy-web

EXPOSE 3000

CMD ["pnpm", "start"]
