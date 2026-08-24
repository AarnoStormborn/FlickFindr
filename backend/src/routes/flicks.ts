import type { FastifyInstance } from "fastify";
import { logger } from "../logger.js";
import type { MovieResult, Queryable } from "../models.js";
import { toMovieResult } from "../services/structural.js";

interface FlicksDeps {
  db: Queryable;
}

export function flicksRoutes(app: FastifyInstance, deps: FlicksDeps): void {
  const { db } = deps;

  app.get("/flicks/", async (request, reply) => {
    try {
      const skip = Number((request.query as Record<string, unknown>).skip ?? 0);
      const limit = Number((request.query as Record<string, unknown>).limit ?? 10);
      const { rows } = await db.query(
        "SELECT id, movie_name, rating, runtime, genre, metascore, plot, directors, stars, votes, gross, poster_url FROM movies ORDER BY rating DESC NULLS LAST LIMIT $1 OFFSET $2",
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
    try {
      const movieId = Number((request.params as Record<string, unknown>).movie_id);
      const { rows } = await db.query(
        "SELECT id, movie_name, rating, runtime, genre, metascore, plot, directors, stars, votes, gross, poster_url FROM movies WHERE id = $1",
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

  app.get("/flicks/filter", async (request, reply) => {
    try {
      const q = request.query as Record<string, string | undefined>;
      const where: string[] = [];
      const params: unknown[] = [];
      for (const col of ["genre", "directors", "stars"] as const) {
        const value = q[col];
        if (value) {
          params.push(`%${value}%`);
          where.push(`${col} ILIKE $${params.length}`);
        }
      }
      const skip = Number(q.skip ?? 0);
      const limit = Number(q.limit ?? 10);
      params.push(limit, skip);
      const { rows } = await db.query(
        `SELECT id, movie_name, rating, runtime, genre, metascore, plot, directors, stars, votes, gross, poster_url FROM movies ${
          where.length ? `WHERE ${where.join(" AND ")}` : ""
        } ORDER BY rating DESC NULLS LAST LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      if (rows.length === 0) {
        return reply.code(404).send({ detail: "No movies found for matching criteria" });
      }
      logger.info({ len: rows.length, genre: q.genre }, "Filtered movies");
      return rows.map(toMovieResult);
    } catch (err) {
      logger.error({ err }, "Error fetching filtered movies");
      return reply.code(500).send({ detail: "Internal Server Error" });
    }
  });
}

export type { MovieResult };