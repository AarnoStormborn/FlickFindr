import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { HybridSearchRequestSchema, type HybridSearchRequest } from "../models.js";
import { getModelRuntime } from "./runtime.js";

const PARSE_PROMPT = `You are a movie-catalog query parser. Convert the user's natural-language
movie search request into a single JSON object with ONLY these fields (omit any that are unknown):

{
  "query": string,        // the core search intent (what kind of movie they want)
  "genre": string | null,      // genre name if clearly stated
  "directors": string | null,  // director name if clearly stated
  "stars": string | null,      // actor name if clearly stated
  "min_rating": number | null, // 0-10, if a rating floor is stated
  "max_rating": number | null,
  "min_runtime": number | null,
  "max_runtime": number | null,
  "sort_by": "rating" | "runtime" | "movie_name" | "metascore" | null,
  "sort_order": "asc" | "desc" | null
}

Rules:
- "query" must be short (5-15 words) and capture the plot/theme intent, e.g. "prison escape and friendship".
- Do not include genre/rating words inside "query" if they are already extracted as filters.
- Respond with the JSON object only. No markdown fences, no prose.`;

/** Best-effort extraction of the final assistant text from a session's messages. */
function lastAssistantText(messages: unknown[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg?.role !== "assistant") continue;
    const content = msg.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((p): p is { type: string; text?: string } => typeof p === "object" && p !== null && "text" in p)
        .map((p) => p.text ?? "")
        .join("");
      if (text) return text;
    }
  }
  return undefined;
}

function parseJsonObject(raw: string): HybridSearchRequest | undefined {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/^```\s*$/, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]);
    const validated = HybridSearchRequestSchema.safeParse({
      query: String(parsed.query ?? ""),
      limit: parsed.limit ?? 10,
      genre: parsed.genre ?? undefined,
      directors: parsed.directors ?? undefined,
      stars: parsed.stars ?? undefined,
      min_rating: parsed.min_rating ?? undefined,
      max_rating: parsed.max_rating ?? undefined,
      min_runtime: parsed.min_runtime ?? undefined,
      max_runtime: parsed.max_runtime ?? undefined,
    });
    return validated.success ? validated.data : undefined;
  } catch {
    return undefined;
  }
}

/** Build a minimal resource loader (no extensions/skills/prompts from disk). */
async function minimalLoader(): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    extensionFactories: [],
    skillsOverride: (current) => ({ skills: [], diagnostics: current.diagnostics }),
    promptsOverride: (current) => ({ prompts: [], diagnostics: current.diagnostics }),
    systemPromptOverride: () => "You are a movie search query parser. Be precise and terse.",
  });
  await loader.reload();
  return loader;
}

/**
 * Run a Pi agent to parse a natural-language query into a structured
 * HybridSearchRequest. Falls back to { query } on agent failure.
 */
export async function parseSearchQuery(rawQuery: string): Promise<HybridSearchRequest> {
  const fallback: HybridSearchRequest = { query: rawQuery, limit: 10 };
  if (!config.agent.enabled || !rawQuery.trim()) return fallback;

  let session: Awaited<ReturnType<typeof createAgentSession>> | undefined;
  const timer = setTimeout(() => {
    logger.warn("Query parser timed out; aborting agent");
    void session?.session.abort();
  }, config.agent.queryTimeoutMs);

  try {
    const modelRuntime = await getModelRuntime();
    const resourceLoader = await minimalLoader();
    const result = await createAgentSession({
      modelRuntime,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      thinkingLevel: "off",
      tools: [],
    });
    session = result;

    await session.session.prompt(`${PARSE_PROMPT}\n\nUser query: "${rawQuery}"`);
    const text = lastAssistantText(session.session.messages);
    const parsed = text ? parseJsonObject(text) : undefined;

    // Require a non-empty, non-identical query to consider the parse successful.
    if (parsed && parsed.query.trim() && parsed.query !== rawQuery) {
      logger.info({ parsed }, "Agent parsed query");
      return parsed;
    }
    logger.warn({ text }, "Agent parse unusable; falling back to raw query");
    return fallback;
  } catch (err) {
    logger.error({ err }, "Agent query parsing failed; falling back to raw query");
    return fallback;
  } finally {
    clearTimeout(timer);
    session?.session.dispose();
  }
}