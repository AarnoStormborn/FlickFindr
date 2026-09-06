import { logger } from "../logger.js";
import type { MovieResult, Queryable, SemanticSearchRequest } from "../models.js";
import { toMovieResult } from "./structural.js";

export const SIMILARITY_THRESHOLD = 0.6;

const SIMILARITY_SELECT = `${"id, movie_name, release_year, rating, runtime, genre, metascore, plot, directors, stars, votes, gross, poster_url"},\n  1 - (plot_embedding <=> CAST($1 AS vector)) AS similarity_score`;

function toSemanticResult(row: Record<string, unknown>): MovieResult {
  const movie = toMovieResult(row);
  movie.similarity_score =
    "similarity_score" in row && row.similarity_score !== null
      ? Number(row.similarity_score)
      : null;
  return movie;
}

function categorize(
  movies: MovieResult[],
  hasFilters: boolean,
  kind: "semantic" | "hybrid",
): { exact_matches: boolean; message: string } {
  const exact_matches = movies.some(
    (m) => m.similarity_score !== null && m.similarity_score !== undefined && m.similarity_score >= SIMILARITY_THRESHOLD,
  );
  let message: string;
  if (exact_matches) {
    message = "Movies found matching your query";
  } else if (movies.length > 0) {
    // Hybrid is always a fuzzy/ranked search — never frame it as "no exact
    // match". Semantic keeps the helpful similar-movies caveat.
    message =
      kind === "hybrid"
        ? "Here are some movies we think you'll like"
        : "No exact matches found, but here are some similar movies";
  } else {
    message = hasFilters ? "No movies found matching your criteria" : "No movies found";
  }
  return { exact_matches, message };
}

export const semanticService = {
  /**
   * Semantic search: embed the query, then rank rows by cosine similarity
   * to the query embedding using the pgvector `<=>` operator.
   */
  async semanticSearch(db: Queryable, req: { query: string; limit: number; skip?: number }, getEmbedding: (text: string) => Promise<number[]>): Promise<{ movies: MovieResult[]; total: number; exact_matches: boolean; message: string }> {
    try {
      const embedding = await getEmbedding(req.query);
      const vec = `[${embedding.join(",")}]`;
      const skip = req.skip ?? 0;

      const { rows } = await db.query(
        `SELECT ${SIMILARITY_SELECT}
         FROM movies
         WHERE plot_embedding IS NOT NULL
         ORDER BY plot_embedding <=> CAST($1 AS vector)
         LIMIT $2 OFFSET $3`,
        [vec, req.limit, skip],
      );
      const { rows: countRows } = await db.query(
        "SELECT count(*)::int AS total FROM movies WHERE plot_embedding IS NOT NULL",
      );

      const movies = rows.map(toSemanticResult);
      const total = Number(countRows[0]?.total ?? movies.length);
      const { exact_matches, message } = categorize(movies, false, "semantic");
      logger.info({ len: movies.length, total, exact_matches, query: req.query.slice(0, 50) }, "Semantic search executed");
      return { movies, total, exact_matches, message };
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
    req: { query: string; limit: number; skip?: number; genre?: string; directors?: string; stars?: string; min_rating?: number; max_rating?: number; min_runtime?: number; max_runtime?: number },
    getEmbedding: (text: string) => Promise<number[]>,
  ): Promise<{ movies: MovieResult[]; total: number; exact_matches: boolean; message: string }> {
    try {
      const embedding = await getEmbedding(req.query);
      const vec = `[${embedding.join(",")}]`;
      const skip = req.skip ?? 0;

      const run = async (useCategorical: boolean): Promise<{ movies: MovieResult[]; total: number; usedFilters: boolean }> => {
        // conditions are built for the DATA query where $1 = the vector;
        // base starts at 1. The COUNT query re-binds the same filter values
        // starting at $1 (no vector) via bindFilterSql().
        const vec = `[${embedding.join(",")}]`;
        const condsData: string[] = []; // numbered from $2 (data query, $1 = vec)
        const condsCount: string[] = []; // numbered from $1 (count query)
        const filterValues: unknown[] = [];
        const addCond = (column: string, value: unknown, op = "ILIKE", pattern = false) => {
          if (value === undefined || value === null) return;
          filterValues.push(pattern ? `%${value}%` : value);
          condsData.push(`${column} ${op} $${filterValues.length + 1}`);
          condsCount.push(`${column} ${op} $${filterValues.length}`);
        };
        if (useCategorical) {
          addCond("genre", req.genre, "ILIKE", true);
          addCond("directors", req.directors, "ILIKE", true);
          addCond("stars", req.stars, "ILIKE", true);
        }
        addCond("rating", req.min_rating, ">=");
        addCond("rating", req.max_rating, "<=");
        addCond("runtime", req.min_runtime, ">=");
        addCond("runtime", req.max_runtime, "<=");

        const whereSql = `plot_embedding IS NOT NULL${condsData.length ? ` AND ${condsData.join(" AND ")}` : ""}`;
        // COUNT query: same filters numbered from $1 (no vector involved).
        const countSql = condsCount.length
          ? `SELECT count(*)::int AS total FROM movies WHERE ${condsCount.join(" AND ")}`
          : "SELECT count(*)::int AS total FROM movies WHERE plot_embedding IS NOT NULL";
        const { rows: countRows } = await db.query(countSql, filterValues);
        const total = Number(countRows[0]?.total ?? 0);

        const sql = `SELECT ${SIMILARITY_SELECT}
          FROM movies
          WHERE ${whereSql}
          ORDER BY plot_embedding <=> CAST($1 AS vector)
          LIMIT $${filterValues.length + 2} OFFSET $${filterValues.length + 3}`;
        const dataParams = [vec, ...filterValues, req.limit, skip];

        const { rows } = await db.query(sql, dataParams);
        return { movies: rows.map(toSemanticResult), total, usedFilters: condsData.length > 0 };
      };

      const strict = await run(true);
      const anyCategorical = Boolean(req.genre || req.directors || req.stars);
      const relaxed =
        anyCategorical && strict.movies.length === 0 ? await run(false) : undefined;
      const movies = relaxed ? relaxed.movies : strict.movies;
      const total = relaxed ? relaxed.total : strict.total;
      const usedFilters = relaxed ? relaxed.usedFilters : strict.usedFilters;

      const { exact_matches, message } = categorize(movies, usedFilters, "hybrid");
      logger.info(
        { len: movies.length, total, exact_matches, relaxed: Boolean(req.genre || req.directors || req.stars) && strict.movies.length === 0 && movies.length > 0, query: req.query.slice(0, 50) },
        "Hybrid search executed",
      );
      return { movies, total, exact_matches, message };
    } catch (err) {
      logger.error({ err }, "Hybrid search failed");
      throw err;
    }
  },
};