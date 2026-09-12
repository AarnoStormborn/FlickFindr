import "dotenv/config";

/**
 * Central runtime configuration. Reads environment variables with dev
 * defaults matching docker-compose, so the backend boots without a .env.
 */

function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const db = {
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5433),
  name: process.env.DB_NAME ?? "flickfindr",
  user: process.env.DB_USER ?? "flickfindr",
  password: process.env.DB_PASSWORD ?? "flickfindr",
};

// A single connection string overrides the individual parts (Supabase,
// Neon, and managed hosts expose one postgres:// URL with special chars).
const databaseUrl =
  process.env.DATABASE_URL ??
  `postgresql://${db.user}:${db.password}@${db.host}:${db.port}/${db.name}`;

export const config = {
  databaseUrl,
  db,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6380",
  port: Number(process.env.PORT ?? 8001),
  logLevel: process.env.LOG_LEVEL ?? "info",
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  agent: {
    enabled: (process.env.AGENT_ENABLED ?? "true") !== "false",
    model: process.env.PI_MODEL ?? undefined,
    /**
     * Ordered fallbacks, tried after PI_MODEL. Defaults to the free/cheap
     * Command Code models, cheapest-capable first, so the agent never
     * silently lands on a premium model.
     */
    modelFallbacks: process.env.AGENT_MODEL_FALLBACKS
      ? parseList(process.env.AGENT_MODEL_FALLBACKS)
      : [
          "commandcode/poolside/laguna-s-2.1-free",
          "commandcode/deepseek/deepseek-v4-flash",
          "commandcode/xiaomi/mimo-v2.5",
          "commandcode/z-ai/glm-5.3-flash",
          "commandcode/Qwen/Qwen3.8-Flash",
        ],
    /** Override the bundled pi-agent/models.json location. */
    modelsPath: process.env.PI_MODELS_PATH ?? undefined,
    queryTimeoutMs: Number(process.env.AGENT_QUERY_TIMEOUT_MS ?? 30_000),
    chatTimeoutMs: Number(process.env.CHAT_TIMEOUT_MS ?? 120_000),
  },
} as const;