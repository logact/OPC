# syntax=docker/dockerfile:1
ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-alpine AS base

RUN npm install -g pnpm@9.15.0

WORKDIR /app

# ── Stage 1: Install production dependencies ─────────────────────────
FROM base AS deps

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/core/package.json ./packages/core/
COPY packages/database/package.json ./packages/database/
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/sdk/package.json ./packages/sdk/

RUN pnpm install --frozen-lockfile --prod

# ── Stage 2: Runtime ────────────────────────────────────────────────
FROM base AS runner

WORKDIR /app

# Copy production node_modules
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages ./packages

# Copy pre-built dist outputs (built by CI)
COPY apps/server/dist ./apps/server/dist
COPY apps/server/package.json ./apps/server/package.json
COPY packages/core/dist ./packages/core/dist
COPY packages/database/dist ./packages/database/dist
COPY packages/protocol/dist ./packages/protocol/dist
COPY packages/sdk/dist ./packages/sdk/dist

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

USER node

CMD ["node", "apps/server/dist/index.js"]
