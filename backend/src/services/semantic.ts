import { logger } from "../logger.js";
import type { MovieResult, Queryable, SemanticSearchRequest } from "../models.js";
import { toMovieResult } from "./structural.js";

export const SIMILARITY_THRESHOLD = 0.6;

const SIMILARITY_SELECT = `${"id, movie_name, rating, runtime, genre, metascore, plot, directors, stars, votes, gross, poster_url"},\n  1 - (plot_embedding <=> CAST($1 AS vector)) AS similarity_score`;

function toSemanticResult(row: Record<string, unknown>): MovieResult {
  const movie = toMovieResult(row);
  movie.similarity_score =
    "similarity_score" in row && row.similarity_score !== null
      ? Number(row.similarity_score)
      : null;
  return movie;
}

function categorize(movies: MovieResult[], hasFilters: boolean): { exact_matches: boolean; message: string } {
  const exact_matches = movies.some(
    (m) => m.similarity_score !== null && m.similarity_score !== undefined && m.similarity_score >= SIMILARITY_THRESHOLD,
  );
  let message: string;
  if (exact_matches) message = "Movies found matching your query";
  else if (movies.length > 0) message = hasFilters ? "No exact matches found, but here are some similar movies" : "No exact matches found, but here are some similar movies";
  else message = hasFilters ? "No movies found matching your criteria" : "No movies found";
  return { exact_matches, message };
}

export const semanticService = {
  /**
   * Semantic search: embed the query, then rank rows by cosine similarity
   * to the query embedding using the pgvector `<=>` operator.
   */
  async semanticSearch(db: Queryable, req: SemanticSearchRequest, getEmbedding: (text: string) => Promise<number[]>): Promise<{ movies: MovieResult[]; exact_matches: boolean; message: string }> {
    try {
      const embedding = await getEmbedding(req.query);
      const vec = `[${embedding.join(",")}]`;

      const { rows } = await db.query(
        `SELECT ${SIMILARITY_SELECT}
         FROM movies
         WHERE plot_embedding IS NOT NULL
         ORDER BY plot_embedding <=> CAST($1 AS vector)
         LIMIT $2`,
        [vec, req.limit],
      );

      const movies = rows.map(toSemanticResult);
      const { exact_matches, message } = categorize(movies, false);
      logger.info({ len: movies.length, exact_matches, query: req.query.slice(0, 50) }, "Semantic search executed");
      return { movies, exact_matches, message };
    } catch (err) {
      logger.error({ err }, "Semantic search failed");
      throw err;
    }
  },

  /**
   * Hybrid search: structural filters ANDed into the pgvector query,
   * results ranked by semantic similarity. Falls back to relaxing
   * categorical filters (genre/directors/stars) when the strict
   * conjunction returns no rows.
   */
  async hybridSearch(
    db: Queryable,
    req: { query: string; limit: number; genre?: string; directors?: string; stars?: string; min_rating?: number; max_rating?: number; min_runtime?: number; max_runtime?: number },
    getEmbedding: (text: string) => Promise<number[]>,
  ): Promise<{ movies: MovieResult[]; exact_matches: boolean; message: string }> {
    try {
      const embedding = await getEmbedding(req.query);
      const vec = `[${embedding.join(",")}]`;

      const run = async (useCategorical: boolean): Promise<{ movies: MovieResult[]; usedFilters: boolean }> => {
        const where: string[] = ["plot_embedding IS NOT NULL"];
        const params: unknown[] = [vec];
        const addFilter = (column: string, value: unknown, op = "ILIKE", pattern = false) => {
          if (value === undefined || value === null) return;
          params.push(pattern ? `%${value}%` : value);
          where.push(`${column} ${op} $${params.length}`);
        };
        if (useCategorical) {
          addFilter("genre", req.genre, "ILIKE", true);
          addFilter("directors", req.directors, "ILIKE", true);
          addFilter("stars", req.stars, "ILIKE", true);
        }
        addFilter("rating", req.min_rating, ">=");
        addFilter("rating", req.max_rating, "<=");
        addFilter("runtime", req.min_runtime, ">=");
        addFilter("runtime", req.max_runtime, "<=");

        params.push(req.limit);
        const sql = `SELECT ${SIMILARITY_SELECT}
          FROM movies
          WHERE ${where.join(" AND ")}
          ORDER BY plot_embedding <=> CAST($1 AS vector)
          LIMIT $${params.length}`;

        const { rows } = await db.query(sql, params);
        return { movies: rows.map(toSemanticResult), usedFilters: where.length > 1 };
      };

      const strict = await run(true);
      const anyCategorical = Boolean(req.genre || req.directors || req.stars);
      const relaxed =
        anyCategorical && strict.movies.length === 0 ? await run(false) : undefined;
      const movies = relaxed ? relaxed.movies : strict.movies;
      const usedFilters = relaxed ? relaxed.usedFilters : strict.usedFilters;

      const { exact_matches, message } = categorize(movies, usedFilters);
      logger.info(
        { len: movies.length, exact_matches, relaxed: Boolean(req.genre || req.directors || req.stars) && strict.movies.length === 0 && movies.length > 0, query: req.query.slice(0, 50) },
        "Hybrid search executed",
      );
      return { movies, exact_matches, message };
    } catch (err) {
      logger.error({ err }, "Hybrid search failed");
      throw err;
    }
  },
};