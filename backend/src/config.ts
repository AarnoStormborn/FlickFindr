// Tests must not read the developer's .env: it holds live provider keys, and
// loading them made the suite call real LLM APIs on every /chat test — slow,
// network-flaky (the SSE/rate-limit tests timed out at 10s), and it silently
// burns free-tier quota. Vitest sets NODE_ENV=test.
if (process.env.NODE_ENV !== "test") {
  await import("dotenv/config");
}

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
    /**
     * Ordered fallbacks, tried after PI_MODEL.
     *
     * Primary is DeepSeek direct: cheap (~$0.14/$0.28 per M tokens, roughly
     * $0.003-0.01 per concierge turn), fast, and reliable — free tiers were
     * measured to be too throttled and too flaky for a multi-step tool loop
     * (Groq: 36-253s per turn, ~60% success; Command Code free: 100 req/day).
     *
     * Everything after it is a fallback so a billing problem or outage
     * degrades to free before it degrades to broken. Pi reads each key from the
     * environment and providers without a key simply do not appear, so listing
     * several costs nothing.
     */
    modelFallbacks: process.env.AGENT_MODEL_FALLBACKS
      ? parseList(process.env.AGENT_MODEL_FALLBACKS)
      : [
          // Primary: reliable and cheap.
          "deepseek/deepseek-v4-flash",
          // Free tiers. Only ids Pi's catalog can actually route are listed:
          // it does not know several models the providers themselves offer
          // (e.g. groq/qwen/qwen3.8-27b), and a dead entry just burns a retry.
          "groq/openai/gpt-oss-120b",
          "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
          "openrouter/poolside/laguna-s-2.1:free",
          "openrouter/google/gemma-4-31b-it:free",
          "commandcode/meituan/LongCat-2.0:free",
          "commandcode/inclusionai/ling-3.0-flash-sante:free",
          // Other cheap paid options.
          "deepseek/deepseek-v4-pro",
          "cerebras/gpt-oss-120b",
          "google/gemini-2.5-flash-lite",
          "commandcode/deepseek/deepseek-v4-flash",
        ],
    /** Override the bundled pi-agent/models.json location. */
    modelsPath: process.env.PI_MODELS_PATH ?? undefined,
    queryTimeoutMs: Number(process.env.AGENT_QUERY_TIMEOUT_MS ?? 30_000),
    /**
     * Chat can legitimately take a while: a tool loop is several model calls,
     * and free tiers throttle per-minute tokens, so a turn can exceed two
     * minutes (measured: 40-135s on Groq's free tier). Too low and the agent
     * gets aborted mid-loop, which surfaces as an empty reply.
     */
    chatTimeoutMs: Number(process.env.CHAT_TIMEOUT_MS ?? 240_000),
  },
} as const;