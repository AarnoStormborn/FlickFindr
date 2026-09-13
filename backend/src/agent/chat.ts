import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { logger } from "../logger.js";
import type { Queryable } from "../models.js";
import { structuralService, MOVIE_COLUMNS } from "../services/structural.js";
import { semanticService } from "../services/semantic.js";
import { AGENT_DIR, getModelRuntime, resolveAgentModelCandidates } from "./runtime.js";

export interface ChatSessionCallbacks {
  onDelta: (text: string) => void;
  /** Discard text streamed so far (the agent is about to replace it). */
  onReset?: () => void;
  /** Movies surfaced by the agent's search tools, for rendering as cards. */
  onMovies?: (movies: ChatMovie[]) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

/** The subset of a movie row the chat UI renders as a card. */
export interface ChatMovie {
  id: number;
  movie_name: string;
  release_year: number | null;
  rating: number | null;
  runtime: number | null;
  genre: string | null;
  poster_url: string | null;
}

/**
 * Gist length for plot text sent back to the model. Full synopses are the
 * single biggest cost in a tool result and the agent only needs enough to
 * judge thematic fit; it can call get_movie for the full text.
 */
const PLOT_SNIPPET_CHARS = 200;

/**
 * Compact projection of a movie row for the MODEL.
 *
 * Full rows carry plot + directors + stars + votes + gross + poster_url, which
 * an agent re-sends on every step of a tool loop — that dominates token spend
 * and is what makes low free-tier token budgets run out. The UI still receives
 * the full rows via surface(); only the model sees this leaner shape.
 */
export function toAgentRow(row: Record<string, unknown>): Record<string, unknown> {
  const plot = row?.plot === null || row?.plot === undefined ? null : String(row.plot);
  return {
    id: row?.id,
    movie_name: row?.movie_name,
    release_year: row?.release_year ?? null,
    rating: row?.rating ?? null,
    runtime: row?.runtime ?? null,
    genre: row?.genre ?? null,
    plot: plot
      ? plot.length > PLOT_SNIPPET_CHARS
        ? `${plot.slice(0, PLOT_SNIPPET_CHARS).trimEnd()}\u2026`
        : plot
      : null,
  };
}

/** Trim a tool result row down to the fields the chat UI needs. */
function toChatMovie(row: Record<string, unknown>): ChatMovie | undefined {
  // Tolerate string/numeric ids: pg returns bigint columns as strings.
  const rawId = row?.id;
  const id = typeof rawId === "number" ? rawId : typeof rawId === "string" ? Number(rawId) : NaN;
  if (!Number.isFinite(id)) return undefined;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id,
    movie_name: String(row.movie_name ?? ""),
    release_year: num(row.release_year),
    rating: num(row.rating),
    runtime: num(row.runtime),
    genre: str(row.genre),
    poster_url: str(row.poster_url),
  };
}

/**
 * Pull the movie rows out of a search result.
 *
 * The services do NOT share a key: structural search returns `{ results }`
 * while semantic and hybrid return `{ movies }`. Reading only one of those
 * silently yields no cards for the other, so accept both.
 */
export function extractMovieRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") {
    const rec = result as { results?: unknown; movies?: unknown };
    if (Array.isArray(rec.results)) return rec.results;
    if (Array.isArray(rec.movies)) return rec.movies;
  }
  return [];
}

export interface ChatRunner {
  run(message: string, userHistory?: { role: "user" | "assistant"; content: string }[]): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
}

const CHAT_SYSTEM_PROMPT = `You are FlickFindr's movie assistant, helping users discover movies.
Use the provided tools to search the catalog (structural, semantic, hybrid), fetch movie details,
and list genres or stats. Be concise and friendly. When you recommend a movie, mention why it
matches the user's request. If a tool errors or returns nothing, say so plainly.

Style rules (the UI renders plain text, not markdown):
- Write prose. Do NOT use markdown syntax — no #, *, _, |, backticks, or --- rules.
- Do not prefix your reply with narration about searching, e.g. "Let me search..."; just answer.
- Name each recommendation as "Title (Year)" followed by one or two sentences on why it fits.
- Recommend at most 5 movies, and never mention a movie the tools did not return.

Curation: once you have decided which movies to recommend, call show_movies with their ids so
the UI can display them. Search results alone are noisy — only pass the ones you actually
recommend. Do this before writing your final answer.`;

export function buildChatTools(
  db: Queryable,
  embed: (text: string) => Promise<number[]>,
  onSearchResults?: (movies: ChatMovie[]) => void,
  onCurated?: (movies: ChatMovie[]) => void,
) {
  /** Normalise a tool result into chat movies. */
  const toMovies = (result: unknown) =>
    extractMovieRows(result)
      .map((r) => toChatMovie(r as Record<string, unknown>))
      .filter((m): m is ChatMovie => m !== undefined);

  /** Report whatever a search tool found so the UI can show real cards. */
  const surface = (result: unknown) => {
    if (!onSearchResults) return;
    const movies = toMovies(result);
    if (movies.length) onSearchResults(movies);
  };

  /** Agent-chosen picks, which take precedence over raw search output. */
  const surfaceCurated = (result: unknown) => {
    if (!onCurated) return;
    const movies = toMovies(result);
    if (movies.length) onCurated(movies);
  };

  return [
    defineTool({
      name: "search_movies",
      label: "Search movies",
      description: "Structural search: filter/sort the catalog (query, genre, directors, stars, rating/runtime ranges).",
      parameters: Type.Object({
        query: Type.Optional(Type.String()),
        genre: Type.Optional(Type.String()),
        directors: Type.Optional(Type.String()),
        stars: Type.Optional(Type.String()),
        min_rating: Type.Optional(Type.Number()),
        max_rating: Type.Optional(Type.Number()),
        min_runtime: Type.Optional(Type.Number()),
        max_runtime: Type.Optional(Type.Number()),
        sort_by: Type.Optional(Type.Union([
          Type.Literal("rating"), Type.Literal("runtime"),
          Type.Literal("movie_name"), Type.Literal("metascore"),
        ])),
        sort_order: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      execute: async (_id, params) => {
        const { results, total } = await structuralService.executeSearch(db, {
          query: params.query,
          genre: params.genre,
          directors: params.directors,
          stars: params.stars,
          min_rating: params.min_rating,
          max_rating: params.max_rating,
          min_runtime: params.min_runtime,
          max_runtime: params.max_runtime,
          sort_by: params.sort_by ?? "rating",
          sort_order: params.sort_order ?? "desc",
          skip: 0,
          limit: params.limit ?? 10,
        });
        // UI cards keep full rows (poster etc.); the model gets the lean shape.
        surface(results);
        const compact = results.map((r) => toAgentRow(r as unknown as Record<string, unknown>));
        return { content: [{ type: "text" as const, text: JSON.stringify({ results: compact, total }) }], details: {} };
      },
    }),
    defineTool({
      name: "semantic_search",
      label: "Semantic search",
      description: "Find movies by plot description / vibe using embeddings.",
      parameters: Type.Object({
        query: Type.String({ minLength: 3 }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      execute: async (_id, params) => {
        const result = await semanticService.semanticSearch(db, { query: params.query, limit: params.limit ?? 10 }, embed);
        surface(result);
        const lean = {
          ...result,
          movies: (result.movies ?? []).map((m) => toAgentRow(m as unknown as Record<string, unknown>)),
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(lean) }], details: {} };
      },
    }),
    defineTool({
      name: "hybrid_search",
      label: "Hybrid search",
      description: "Combine structural filters with semantic ranking (best for nuanced requests).",
      parameters: Type.Object({
        query: Type.String({ minLength: 3 }),
        genre: Type.Optional(Type.String()),
        directors: Type.Optional(Type.String()),
        stars: Type.Optional(Type.String()),
        min_rating: Type.Optional(Type.Number()),
        max_rating: Type.Optional(Type.Number()),
        min_runtime: Type.Optional(Type.Number()),
        max_runtime: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      execute: async (_id, params) => {
        const result = await semanticService.hybridSearch(
          db,
          { query: params.query, limit: params.limit ?? 10, genre: params.genre, directors: params.directors, stars: params.stars, min_rating: params.min_rating, max_rating: params.max_rating, min_runtime: params.min_runtime, max_runtime: params.max_runtime },
          embed,
        );
        surface(result);
        const leanHybrid = {
          ...result,
          movies: (result.movies ?? []).map((m) => toAgentRow(m as unknown as Record<string, unknown>)),
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(leanHybrid) }], details: {} };
      },
    }),
    defineTool({
      name: "get_movie",
      label: "Get movie details",
      description: "Fetch a single movie by id.",
      parameters: Type.Object({ id: Type.Integer({ minimum: 1 }) }),
      execute: async (_id, params) => {
        const { rows } = await db.query("SELECT id, movie_name, rating, runtime, genre, metascore, plot, directors, stars, votes, gross, poster_url FROM movies WHERE id = $1", [params.id]);
        return { content: [{ type: "text" as const, text: JSON.stringify(rows[0] ?? null) }], details: {} };
      },
    }),
    defineTool({
      name: "show_movies",
      label: "Show movies to the user",
      description:
        "Display the movies you recommend as cards in the UI. Call this once, with the ids of " +
        "your final picks (from search results), before writing your answer.",
      parameters: Type.Object({
        ids: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 12 }),
      }),
      execute: async (_id, params) => {
        const { rows } = await db.query(`SELECT ${MOVIE_COLUMNS} FROM movies WHERE id = ANY($1::int[])`, [params.ids]);
        // Preserve the agent's chosen order rather than the DB's.
        const byId = new Map(rows.map((r) => [Number((r as { id: unknown }).id), r]));
        const ordered = params.ids.map((id) => byId.get(Number(id))).filter((r) => r !== undefined);
        surfaceCurated(ordered);
        return { content: [{ type: "text" as const, text: JSON.stringify({ shown: ordered.length }) }], details: {} };
      },
    }),
    defineTool({
      name: "get_genres",
      label: "List genres",
      description: "List all genres with movie counts.",
      parameters: Type.Object({}),
      execute: async () => {
        const genres = await structuralService.getGenres(db);
        return { content: [{ type: "text" as const, text: JSON.stringify(genres) }], details: {} };
      },
    }),
    defineTool({
      name: "get_stats",
      label: "Catalog stats",
      description: "Rating/runtime extents and total movie count.",
      parameters: Type.Object({}),
      execute: async () => {
        const stats = await structuralService.getStats(db);
        return { content: [{ type: "text" as const, text: JSON.stringify(stats) }], details: {} };
      },
    }),
  ];
}

export async function createChatRunner(db: Queryable, embed: (text: string) => Promise<number[]>, callbacks: ChatSessionCallbacks): Promise<ChatRunner> {
  const modelRuntime = await getModelRuntime();

  /**
   * The agent's own picks. These accumulate across show_movies calls (models
   * often curate one movie at a time) and, once any exist, they win over raw
   * search output — the agent searched to explore, then chose deliberately.
   */
  const curated: ChatMovie[] = [];
  const curatedIds = new Set<number>();

  /** Fallback when the agent never curates: best-rated of the last search. */
  const onSearchResults = (movies: ChatMovie[]) => {
    if (curated.length) return;
    const seen = new Set<number>();
    const deduped = movies.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    if (!deduped.length) return;
    callbacks.onMovies?.(deduped.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 8));
  };

  const onCurated = (movies: ChatMovie[]) => {
    let added = false;
    for (const m of movies) {
      if (curatedIds.has(m.id)) continue;
      curatedIds.add(m.id);
      curated.push(m);
      added = true;
    }
    if (added) callbacks.onMovies?.(curated.slice(0, 12));
  };

  const tools = buildChatTools(db, embed, onSearchResults, onCurated);
  const toolNames = tools.map((t) => t.name);

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: AGENT_DIR,
    extensionFactories: [],
    skillsOverride: (current) => ({ skills: [], diagnostics: current.diagnostics }),
    promptsOverride: (current) => ({ prompts: [], diagnostics: current.diagnostics }),
    systemPromptOverride: () => CHAT_SYSTEM_PROMPT,
  });
  await resourceLoader.reload();

  /**
   * Build one session bound to a specific model, tracking whether it produced
   * anything. Free models can be exhausted ("used all 100 free requests") or
   * silently return nothing, so the caller needs to know when a run was empty.
   */
  async function startSession(model?: (typeof candidates)[number]) {
    // The agent narrates while working ("Let me search for...") and then
    // repeats itself in the real answer, so a naive stream shows the same
    // sentence twice. Narration is discarded only once real replacement text
    // starts arriving — resetting eagerly would leave the user with an empty
    // reply whenever the model's final message turns out to be blank.
    let textBlocks = 0;
    let sawToolCall = false;
    let pendingReset = false;
    let produced = false;
    let gotText = false;

    const { session } = await createAgentSession({
      modelRuntime,
      // Pass the model explicitly: omitting it falls back to "first available",
      // which over a 69-model catalog can silently select a premium model.
      ...(model ? { model } : {}),
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      // "off": these models are reasoning-capable, and at higher levels they
      // can spend the final turn on reasoning and return empty content (a
      // silent empty reply). A movie concierge does not need deep reasoning,
      // and skipping it is also faster and cheaper per turn.
      thinkingLevel: "off",
      tools: toolNames,
      customTools: tools,
    });

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        sawToolCall = true;
        produced = true;
        return;
      }
      if (event.type !== "message_update") return;
      const ev = event.assistantMessageEvent;
      if (ev.type === "text_start") {
        if (sawToolCall) {
          sawToolCall = false;
          textBlocks = 0;
          pendingReset = true;
        }
        textBlocks += 1;
        if (textBlocks > 1) callbacks.onDelta("\n\n");
      } else if (ev.type === "text_delta") {
        if (pendingReset) {
          pendingReset = false;
          callbacks.onReset?.();
        }
        produced = true;
        gotText = true;
        callbacks.onDelta(ev.delta);
      }
    });

    // `produced` covers tool activity; `gotText` is what the user can read.
    // A run that surfaced cards but said nothing is a failure, not a result.
    return { session, unsubscribe, produced: () => produced, gotText: () => gotText };
  }

  const candidates = await resolveAgentModelCandidates();
  logger.info({ tools: toolNames, candidates: candidates.length }, "Chat agent session created");
  let active = await startSession(candidates[0]);

  return {
    async run(message: string, history: { role: "user" | "assistant"; content: string }[] = []) {
      const composite = history.length
        ? `${history.map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`).join("\n")}\n\nUser: ${message}`
        : message;

      // Cap attempts: each one may bill against a paid model, and a
      // persistently broken request should fail rather than burn quota.
      const attempts = Math.min(candidates.length, 3) || 1;
      let lastError: unknown;

      for (let i = 0; i < attempts; i++) {
        if (i > 0) {
          const next = candidates[i];
          logger.warn(
            { model: next ? `${next.provider}/${next.id}` : "default" },
            "Retrying chat with the next model",
          );
          callbacks.onReset?.();
          active.unsubscribe();
          active.session.dispose();
          active = await startSession(next);
        }
        try {
          await active.session.prompt(composite);
          if (active.gotText()) {
            // Log the winner explicitly: without this, "which model actually
            // answered?" is unanswerable, which previously led to a wrong
            // conclusion about a model that Pi's catalog never even had.
            const winner = candidates[i];
            logger.info(
              { model: winner ? `${winner.provider}/${winner.id}` : "default", attempt: i },
              "Chat answered",
            );
            callbacks.onDone?.();
            return;
          }
          // Either nothing at all (typically an exhausted free-model quota,
          // which arrives as an empty completion) or tool calls with no
          // explanation — both are useless to the user, so try the next model.
          lastError = new Error("The model returned no text");
          logger.warn({ attempt: i, hadToolCalls: active.produced() }, "Agent returned no text");
        } catch (err) {
          lastError = err;
          logger.warn({ err, attempt: i }, "Agent run failed");
        }
      }

      throw lastError instanceof Error ? lastError : new Error("The agent produced no response");
    },
    async abort() {
      await active.session.abort();
    },
    dispose() {
      active.unsubscribe();
      active.session.dispose();
    },
  };
}