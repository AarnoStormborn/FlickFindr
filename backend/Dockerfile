# --- Build stage ---
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY pi-agent ./pi-agent
RUN npm run build

# --- Runtime stage ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# pgvector client + curl for healthchecks
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
# Agent provider config (models.json) — resolved relative to dist/ at runtime.
COPY --from=build /app/pi-agent ./pi-agent

# Pre-warm the embedding model so the first search isn't slow.
RUN mkdir -p /app/.cache && chmod -R 777 /app/.cache

EXPOSE 8000
CMD ["sh", "-c", "node dist/index.js"]
