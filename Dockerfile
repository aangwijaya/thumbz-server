# syntax=docker/dockerfile:1.7
# Multi-stage build: full toolchain to compile, slim non-root runtime image.
# The same image runs the API (default CMD) and, from Phase 5, the worker.

FROM node:22-bookworm-slim AS base
WORKDIR /app
# Prisma's query engine needs OpenSSL at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate \
  && npm run build \
  && npm prune --omit=dev \
  && npx prisma generate

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
