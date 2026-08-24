import type { FastifyInstance } from "fastify";
import { parseSearchQuery } from "../agent/queryParser.js";
import { logger } from "../logger.js";
import {
  HybridSearchRequestSchema,
  SemanticSearchRequestSchema,
  StructuralSearchRequestSchema,
  type HybridSearchRequest,
  type Queryable,
  type SearchResponse,
  type SemanticSearchResponse,
} from "../models.js";
import { structuralService } from "../services/structural.js";
import { semanticService } from "../services/semantic.js";

interface SearchDeps {
  db: Queryable;
  embed: (text: string) => Promise<number[]>;
  /** Optional agent hook to interpret natural-language queries. */
  agentParse?: (query: string) => Promise<HybridSearchRequest>;
}

export function searchRoutes(app: FastifyInstance, deps: SearchDeps): void {
  const { db, embed } = deps;
  const agentParse = deps.agentParse ?? parseSearchQuery;

  app.post("/search/structural", async (request, reply) => {
    const parsed = StructuralSearchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues[0]?.message ?? "Invalid request" });
    }
    try {
      const { results, total } = await structuralService.executeSearch(db, parsed.data);
      const body: SearchResponse = {
        results,
        total,
        skip: parsed.data.skip,
        limit: parsed.data.limit,
        has_more: parsed.data.skip + results.length < total,
      };
      return body;
    } catch (err) {
      logger.error({ err }, "Structural search failed");
      return reply.code(500).send({ detail: "Search failed" });
    }
  });

  app.get("/search/genres", async (_request, reply) => {
    try {
      return await structuralService.getGenres(db);
    } catch (err) {
      logger.error({ err }, "Failed to get genres");
      return reply.code(500).send({ detail: "Failed to retrieve genres" });
    }
  });

  app.get("/search/stats", async (_request, reply) => {
    try {
      return await structuralService.getStats(db);
    } catch (err) {
      logger.error({ err }, "Failed to get stats");
      return reply.code(500).send({ detail: "Failed to retrieve statistics" });
    }
  });

  app.post("/search/semantic", async (request, reply) => {
    const parsed = SemanticSearchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues[0]?.message ?? "Invalid request" });
    }
    try {
      // Agent interprets the query; embedding search runs on the interpreted intent.
      const interpreted = await agentParse(parsed.data.query);
      const query = interpreted.query.trim() ? interpreted.query : parsed.data.query;
      const { movies, exact_matches, message } = await semanticService.semanticSearch(
        db,
        { query, limit: parsed.data.limit },
        embed,
      );
      const body: SemanticSearchResponse = {
        results: movies,
        query: parsed.data.query,
        limit: parsed.data.limit,
        exact_matches,
        message,
      };
      return body;
    } catch (err) {
      logger.error({ err }, "Semantic search failed");
      return reply.code(500).send({ detail: "Semantic search failed" });
    }
  });

  app.post("/search/hybrid", async (request, reply) => {
    const parsed = HybridSearchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues[0]?.message ?? "Invalid request" });
    }
    try {
      // Agent enriches: interpret query intent into filters + semantic query.
      const enriched = await agentParse(parsed.data.query);
      const merged: HybridSearchRequest = {
        query: enriched.query.trim() ? enriched.query : parsed.data.query,
        limit: parsed.data.limit,
        genre: enriched.genre ?? parsed.data.genre,
        directors: enriched.directors ?? parsed.data.directors,
        stars: enriched.stars ?? parsed.data.stars,
        min_rating: enriched.min_rating ?? parsed.data.min_rating,
        max_rating: enriched.max_rating ?? parsed.data.max_rating,
        min_runtime: enriched.min_runtime ?? parsed.data.min_runtime,
        max_runtime: enriched.max_runtime ?? parsed.data.max_runtime,
      };
      const { movies, exact_matches, message } = await semanticService.hybridSearch(db, merged, embed);
      const body: SemanticSearchResponse = {
        results: movies,
        query: parsed.data.query,
        limit: parsed.data.limit,
        exact_matches,
        message,
      };
      return body;
    } catch (err) {
      logger.error({ err }, "Hybrid search failed");
      return reply.code(500).send({ detail: "Hybrid search failed" });
    }
  });
}