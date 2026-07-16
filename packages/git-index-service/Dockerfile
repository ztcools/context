# syntax=docker/dockerfile:1
# Build context MUST be the repo root:  docker build -f packages/git-index-service/Dockerfile -t <tag> .

# ---------- builder ----------
FROM node:20-bookworm-slim AS builder
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.15.0 --registry=https://registry.npmmirror.com

WORKDIR /app
COPY . .

# Install only the git-index-service subgraph (core + its deps); skips vscode/chrome/mcp
# native deps (keytar/faiss/better-sqlite3) entirely.
RUN pnpm install --filter "@seeway/claude-context-git-index-service..." --no-frozen-lockfile
# Force-compile native addons (tree-sitter et al.) — pnpm 10 gates build scripts,
# rebuild runs them explicitly. Build toolchain above satisfies node-gyp.
RUN pnpm rebuild -r

RUN pnpm --filter @seeway/claude-context-core build \
 && pnpm --filter @seeway/claude-context-git-index-service build

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Copy the whole workspace (preserves pnpm symlink layout so core resolves + native .node files).
COPY --from=builder /app /app
CMD ["node", "packages/git-index-service/dist/index.js"]
