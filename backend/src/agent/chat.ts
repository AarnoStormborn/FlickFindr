import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { logger } from "../logger.js";
import type { Queryable } from "../models.js";
import { structuralService } from "../services/structural.js";
import { semanticService } from "../services/semantic.js";
import { getModelRuntime } from "./runtime.js";

export interface ChatSessionCallbacks {
  onDelta: (text: string) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

export interface ChatRunner {
  run(message: string, userHistory?: { role: "user" | "assistant"; content: string }[]): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
}

const CHAT_SYSTEM_PROMPT = `You are FlickFindr's movie assistant, helping users discover movies.
Use the provided tools to search the catalog (structural, semantic, hybrid), fetch movie details,
and list genres or stats. Be concise and friendly. When you recommend a movie, mention why it
matches the user's request. If a tool errors or returns nothing, say so plainly.`;

export function buildChatTools(db: Queryable, embed: (text: string) => Promise<number[]>) {
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
        return { content: [{ type: "text" as const, text: JSON.stringify({ results, total }) }], details: {} };
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
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: {} };
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
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: {} };
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
  const tools = buildChatTools(db, embed);
  const toolNames = tools.map((t) => t.name);

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    extensionFactories: [],
    skillsOverride: (current) => ({ skills: [], diagnostics: current.diagnostics }),
    promptsOverride: (current) => ({ prompts: [], diagnostics: current.diagnostics }),
    systemPromptOverride: () => CHAT_SYSTEM_PROMPT,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    thinkingLevel: "medium",
    tools: toolNames,
    customTools: tools,
  });

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      callbacks.onDelta(event.assistantMessageEvent.delta);
    }
  });

  logger.info({ tools: toolNames }, "Chat agent session created");

  return {
    async run(message: string, history: { role: "user" | "assistant"; content: string }[] = []) {
      const composite = history.length
        ? `${history.map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`).join("\n")}\n\nUser: ${message}`
        : message;
      await session.prompt(composite);
      callbacks.onDone?.();
    },
    async abort() {
      await session.abort();
    },
    dispose() {
      unsubscribe();
      session.dispose();
    },
  };
}