# --- Build stage ---
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
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

# Pre-warm the embedding model so the first search isn't slow. warm-embeddings
# compiles to dist/scripts/warm-embeddings.js by the build stage (rootDir .).
RUN mkdir -p /app/.cache && chmod -R 777 /app/.cache

EXPOSE 8000
CMD ["sh", "-c", "node dist/scripts/warm-embeddings.js && node dist/src/index.js"]
