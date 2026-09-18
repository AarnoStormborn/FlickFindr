import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { logger } from "../logger.js";
import type { MovieResult, Queryable } from "../models.js";
import { MOVIE_COLUMNS, toMovieResult } from "../services/structural.js";
import { semanticService } from "../services/semantic.js";
import { getMovieVideos } from "../tmdb.js";

interface FlicksDeps {
  db: Queryable;
}

/**
 * Query params arrive as strings, so they are coerced and bounded rather than
 * passed through `Number()`. Without bounds, `?limit=100000` returned the whole
 * catalogue in one response (30,749 rows) and malformed values reached Postgres
 * and surfaced as 500s: `?skip=abc`, `?limit=-5` and `/flicks/movie/abc`.
 */
const MAX_PAGE_SIZE = 100;
/** Postgres int4 upper bound — larger ids cannot exist, and must not be queried. */
const MAX_MOVIE_ID = 2_147_483_647;

const ListQuerySchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(10),
});

const SimilarQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(12),
});

const FilterQuerySchema = ListQuerySchema.extend({
  // Parameterised into ILIKE, so this is a sanity bound, not an injection guard.
  genre: z.string().max(100).optional(),
  directors: z.string().max(100).optional(),
  stars: z.string().max(100).optional(),
});

const MovieIdParamsSchema = z.object({
  movie_id: z.coerce.number().int().min(1).max(MAX_MOVIE_ID),
});

/** Uniform 400 for invalid input, matching the /search routes. */
function invalid(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ detail: error.issues[0]?.message ?? "Invalid request" });
}

export function flicksRoutes(app: FastifyInstance, deps: FlicksDeps): void {
  const { db } = deps;

  app.get("/flicks/", async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalid(reply, parsed.error);
    const { skip, limit } = parsed.data;
    try {
      const { rows } = await db.query(
        `SELECT ${MOVIE_COLUMNS} FROM movies ORDER BY rating DESC NULLS LAST, id ASC LIMIT $1 OFFSET $2`,
        [limit, skip],
      );
      if (rows.length === 0) return reply.code(404).send({ detail: "Movies not found" });
      logger.info("Movies fetched");
      return rows.map(toMovieResult);
    } catch (err) {
      logger.error({ err }, "Could not fetch movies");
      return reply.code(500).send({ detail: "Internal Server Error" });
    }
  });

  app.get("/flicks/movie/:movie_id", async (request, reply) => {
    const parsedParams = MovieIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) return invalid(reply, parsedParams.error);
    const movieId = parsedParams.data.movie_id;
    try {
      const { rows } = await db.query(
        `SELECT ${MOVIE_COLUMNS} FROM movies WHERE id = $1`,
        [movieId],
      );
      if (rows.length === 0) {
        return reply.code(404).send({ detail: `Movie not found for ID: ${movieId}` });
      }
      logger.info({ movieId }, "Found movie");
      return toMovieResult(rows[0]!);
    } catch (err) {
      logger.error({ err }, "Error fetching movie");
      return reply.code(500).send({ detail: "Internal Server Error" });
    }
  });

  app.get("/flicks/movie/:movie_id/similar", async (request, reply) => {
    const parsedParams = MovieIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) return invalid(reply, parsedParams.error);
    const parsedQuery = SimilarQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) return invalid(reply, parsedQuery.error);
    try {
      const results = await semanticService.similarMovies(db, parsedParams.data.movie_id, parsedQuery.data.limit);
      return { results };
    } catch (err) {
      logger.error({ err }, "Error fetching similar movies");
      return reply.code(500).send({ detail: "Internal Server Error" });
    }
  });

  app.get("/flicks/movie/:movie_id/trailers", async (request, reply) => {
    const parsedParams = MovieIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) return invalid(reply, parsedParams.error);
    const movieId = parsedParams.data.movie_id;
    try {
      const { rows } = await db.query(
        "SELECT tmdb_id, trailer_key, trailer_source, trailer_checked FROM movies WHERE id = $1",
        [movieId],
      );
      const row = rows[0];
      if (!row) {
        return reply.code(404).send({ detail: `Movie not found for ID: ${movieId}` });
      }

      // 1. Already have a stored trailer -> serve it (never touch TMDB again).
      if (row.trailer_key) {
        return {
          results: [
            {
              key: String(row.trailer_key),
              source: row.trailer_source ?? "stored",
              youtubeUrl: `https://www.youtube.com/watch?v=${row.trailer_key}`,
            },
          ],
        };
      }

      // 2. Already checked and found nothing -> don't re-hit TMDB.
      const tmdbId = Number(row.tmdb_id ?? 0);
      if (row.trailer_checked || !tmdbId) {
        return { results: [] };
      }

      // 3. First visit: fetch from TMDB, then persist so we never call again.
      const { ok, videos } = await getMovieVideos(tmdbId);
      // Only cache the result when TMDB actually responded. If the fetch
      // failed (flaky network), leave trailer_checked=false so a later visit
      // retries instead of being permanently marked 'no trailer'.
      if (!ok) {
        return reply.code(503).send({ detail: "Trailer service unavailable, try again" });
      }
      const first = videos[0];
      await db.query(
        "UPDATE movies SET trailer_key = $1, trailer_source = $2, trailer_checked = true WHERE id = $3",
        [first?.key ?? null, first ? "tmdb" : null, movieId],
      );
      return {
        results: first
          ? [
              {
                key: first.key,
                name: first.name,
                type: first.type,
                source: "tmdb",
                youtubeUrl: `https://www.youtube.com/watch?v=${first.key}`,
              },
            ]
          : [],
      };
    } catch (err) {
      logger.error({ err }, "Error fetching trailers");
      return reply.code(500).send({ detail: "Internal Server Error" });
    }
  });

  app.get("/flicks/filter", async (request, reply) => {
    const parsed = FilterQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalid(reply, parsed.error);
    const { skip, limit, genre, directors, stars } = parsed.data;
    try {
      const where: string[] = [];
      const params: unknown[] = [];
      for (const [col, value] of [
        ["genre", genre],
        ["directors", directors],
        ["stars", stars],
      ] as const) {
        if (value) {
          params.push(`%${value}%`);
          where.push(`${col} ILIKE $${params.length}`);
        }
      }
      params.push(limit, skip);
      const { rows } = await db.query(
        `SELECT ${MOVIE_COLUMNS} FROM movies ${
          where.length ? `WHERE ${where.join(" AND ")}` : ""
        } ORDER BY rating DESC NULLS LAST, id ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      if (rows.length === 0) {
        return reply.code(404).send({ detail: "No movies found for matching criteria" });
      }
      logger.info({ len: rows.length, genre }, "Filtered movies");
      return rows.map(toMovieResult);
    } catch (err) {
      logger.error({ err }, "Error fetching filtered movies");
      return reply.code(500).send({ detail: "Internal Server Error" });
    }
  });
}

export type { MovieResult };