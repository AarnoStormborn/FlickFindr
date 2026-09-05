import { logger } from "../logger.js";
import type {
  GenreItem,
  MovieResult,
  MovieRow,
  MovieStats,
  Queryable,
  StructuralSearchRequest,
} from "../models.js";

export const MOVIE_COLUMNS = `id, movie_name, release_year, rating, runtime, genre, metascore, plot,
  directors, stars, votes, gross, poster_url`;

function toMovieResult(row: Record<string, unknown>): MovieResult {
  return {
    id: Number(row.id),
    movie_name: String(row.movie_name ?? ""),
    release_year: row.release_year === null || row.release_year === undefined ? null : Number(row.release_year),
    rating: row.rating === null ? null : Number(row.rating),
    runtime: row.runtime === null ? null : Number(row.runtime),
    genre: row.genre === null ? null : String(row.genre),
    metascore: row.metascore === null ? null : Number(row.metascore),
    plot: row.plot === null ? null : String(row.plot),
    directors: row.directors === null ? null : String(row.directors),
    stars: row.stars === null ? null : String(row.stars),
    votes: row.votes === null ? null : String(row.votes),
    gross: row.gross === null ? null : String(row.gross),
    poster_url: row.poster_url === null ? null : String(row.poster_url),
    similarity_score:
      "similarity_score" in row && row.similarity_score !== null
        ? Number(row.similarity_score)
        : undefined,
  };
}

export interface StructuralQuery {
  sql: string;
  params: unknown[];
  /** Parameterized WHERE clause (no LIMIT/OFFSET params), for count queries. */
  whereSql: string;
  whereParams: unknown[];
}

/** Build SQL WHERE/ORDER/LIMIT for a structural search request. */
export function buildStructuralQuery(req: StructuralSearchRequest): StructuralQuery {
  const where: string[] = [];
  const whereParams: unknown[] = [];

  if (req.query) {
    whereParams.push(`%${req.query}%`);
    where.push(`movie_name ILIKE $${whereParams.length}`);
  }
  if (req.genre) {
    whereParams.push(`%${req.genre}%`);
    where.push(`genre ILIKE $${whereParams.length}`);
  }
  if (req.directors) {
    whereParams.push(`%${req.directors}%`);
    where.push(`directors ILIKE $${whereParams.length}`);
  }
  if (req.stars) {
    whereParams.push(`%${req.stars}%`);
    where.push(`stars ILIKE $${whereParams.length}`);
  }
  if (req.min_rating !== undefined) {
    whereParams.push(req.min_rating);
    where.push(`rating >= $${whereParams.length}`);
  }
  if (req.max_rating !== undefined) {
    whereParams.push(req.max_rating);
    where.push(`rating <= $${whereParams.length}`);
  }
  if (req.min_runtime !== undefined) {
    whereParams.push(req.min_runtime);
    where.push(`runtime >= $${whereParams.length}`);
  }
  if (req.max_runtime !== undefined) {
    whereParams.push(req.max_runtime);
    where.push(`runtime <= $${whereParams.length}`);
  }
  if (req.min_year !== undefined) {
    whereParams.push(req.min_year);
    where.push(`release_year >= $${whereParams.length}`);
  }
  if (req.max_year !== undefined) {
    whereParams.push(req.max_year);
    where.push(`release_year <= $${whereParams.length}`);
  }
  if (req.min_votes !== undefined) {
    // votes is stored as text; cast for a numeric comparison.
    whereParams.push(req.min_votes);
    where.push(`NULLIF(votes, '')::int >= $${whereParams.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = req.sort_order === "desc" ? "DESC" : "ASC";
  const sortColumn = ["movie_name", "rating", "runtime", "metascore", "release_year"].includes(req.sort_by)
    ? req.sort_by
    : "rating";

  return {
    sql: `SELECT ${MOVIE_COLUMNS} FROM movies ${whereSql}
      ORDER BY ${sortColumn} ${order} NULLS LAST
      LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`,
    params: [...whereParams, req.limit, req.skip],
    whereSql,
    whereParams,
  };
}

export const structuralService = {
  /** Execute a structural search; returns matched rows plus the total count. */
  async executeSearch(db: Queryable, req: StructuralSearchRequest): Promise<{ results: MovieResult[]; total: number }> {
    try {
      const query = buildStructuralQuery(req);

      const [data, count] = await Promise.all([
        db.query(query.sql, query.params),
        db.query(
          `SELECT count(*)::int AS total FROM movies ${query.whereSql}`,
          query.whereParams,
        ),
      ]);

      const results = data.rows.map(toMovieResult);
      const total = Number(count.rows[0]?.total ?? 0);
      logger.info({ len: results.length, total }, "Structural search executed");
      return { results, total };
    } catch (err) {
      logger.error({ err }, "Structural search failed");
      throw err;
    }
  },

  /** Unique genres with movie counts (genre column is comma-separated). */
  async getGenres(db: Queryable): Promise<GenreItem[]> {
    try {
      const { rows } = await db.query("SELECT genre FROM movies WHERE genre IS NOT NULL");
      const counts = new Map<string, number>();
      for (const row of rows) {
        for (const genre of String(row.genre ?? "").split(",")) {
          const name = genre.trim();
          if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));
    } catch (err) {
      logger.error({ err }, "Failed to get genres");
      throw err;
    }
  },

  /** Rating/runtime extents + total count, for the filter UI. */
  async getStats(db: Queryable): Promise<MovieStats> {
    try {
      const { rows } = await db.query(
        `SELECT min(rating)::float8 AS min_rating, max(rating)::float8 AS max_rating,
                min(runtime)::int AS min_runtime, max(runtime)::int AS max_runtime,
                count(*)::int AS total_movies FROM movies`,
      );
      const r = rows[0] ?? {};
      return {
        min_rating: Number(r.min_rating ?? 0),
        max_rating: Number(r.max_rating ?? 10),
        min_runtime: Number(r.min_runtime ?? 0),
        max_runtime: Number(r.max_runtime ?? 300),
        total_movies: Number(r.total_movies ?? 0),
      };
    } catch (err) {
      logger.error({ err }, "Failed to get stats");
      throw err;
    }
  },
};

export { toMovieResult };
export type { MovieRow };