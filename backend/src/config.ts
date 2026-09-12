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
    /**
     * Ordered fallbacks, tried after PI_MODEL.
     *
     * Grouped cheapest/free-capable first, then cheap paid, then the Command
     * Code provider. Pi reads each provider's key from the environment
     * (GROQ_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, DEEPSEEK_API_KEY,
     * COMMAND_CODE_API_KEY), and providers with no key simply do not appear in
     * the available list, so listing several costs nothing. Chat also retries
     * with the next candidate when a run produces no output — which is how a
     * free tier running out degrades instead of breaking.
     */
    modelFallbacks: process.env.AGENT_MODEL_FALLBACKS
      ? parseList(process.env.AGENT_MODEL_FALLBACKS)
      : [
          // Groq: fastest by far (300-1,000+ tok/s, ~0.3s/request). Free tier
          // is 1K req/day but only 200K tokens/day and 8K tokens/min.
          //
          // Use qwen3.8-27b, NOT the gpt-oss models: gpt-oss is a reasoning
          // model and, in a tool loop, repeatedly answered with reasoning but
          // no content — measured 1 success in 4 turns, each failure ending
          // silently after ~20s with cards but no text. qwen3.8-27b produced a
          // full answer first try (also 1,048 chars + 5 cards on retest).
          // qwen3.6-27b returns nothing at all, so pin 3.8.
          // Only ids the account actually exposes are listed — an unavailable
          // model costs a whole retry attempt before it fails.
          "groq/qwen/qwen3.8-27b",
          "groq/openai/gpt-oss-120b",
          // OpenRouter free models (17 tool-capable; 50 req/day free, 1,000/day
          // once $10 of credit is on the account). Large context helps here.
          "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
          "openrouter/poolside/laguna-s-2.1:free",
          "openrouter/google/gemma-4-31b-it:free",
          // Command Code free models, then its cheap paid ones.
          "commandcode/meituan/LongCat-2.0:free",
          "commandcode/inclusionai/ling-3.0-flash-sante:free",
          "commandcode/poolside/laguna-s-2.1-free",
          "commandcode/deepseek/deepseek-v4-flash",
          // Direct providers, cheap and reliable.
          "deepseek/deepseek-v4-flash",
          "cerebras/gpt-oss-120b",
          "google/gemini-2.5-flash-lite",
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