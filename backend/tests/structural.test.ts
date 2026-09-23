import { describe, expect, it } from "vitest";
import type { Queryable } from "../src/models.js";
import { buildStructuralQuery, structuralService } from "../src/services/structural.js";
import { WEIGHTED_RATING_SQL } from "../src/services/rating.js";

function fakeDb(rows: Record<string, unknown>[]): Queryable {
  return {
    async query() {
      return { rows };
    },
  };
}

describe("buildStructuralQuery", () => {
  it("builds a plain query with pagination", () => {
    const q = buildStructuralQuery({ query: undefined, sort_by: "rating", sort_order: "desc", skip: 5, limit: 20 });
    // "rating" orders by the vote-weighted score, not the raw column.
    expect(q.sql).toContain(WEIGHTED_RATING_SQL);
    expect(q.sql).toContain("DESC NULLS LAST, id ASC");
    expect(q.sql).not.toContain("ORDER BY rating");
    expect(q.sql).toContain("LIMIT $1 OFFSET $2");
    expect(q.whereSql).toBe("");
    expect(q.params).toEqual([20, 5]);
  });

  it("ranks by the weighted score only when rating is the sort column", () => {
    const weighted = buildStructuralQuery({ sort_by: "rating", sort_order: "desc", skip: 0, limit: 20 });
    expect(weighted.sql).toContain(WEIGHTED_RATING_SQL);

    // Every other column must stay a plain column sort — no score arithmetic.
    // Scoped to the ORDER BY: the SELECT always carries the score as
    // `weighted_rating` so clients can preserve the ranking when merging.
    for (const sort_by of ["runtime", "movie_name", "metascore", "release_year"] as const) {
      const q = buildStructuralQuery({ sort_by, sort_order: "desc", skip: 0, limit: 20 });
      const orderBy = q.sql.slice(q.sql.indexOf("ORDER BY"));
      expect(orderBy, sort_by).toContain(`ORDER BY ${sort_by} DESC NULLS LAST, id ASC`);
      expect(orderBy, sort_by).not.toContain("rating::numeric");
    }
  });

  it("appends filters with positional params", () => {    const q = buildStructuralQuery({ query: "dark", genre: "Crime", min_rating: 7, sort_by: "movie_name", sort_order: "asc", skip: 0, limit: 10 });
    expect(q.whereSql).toBe("WHERE movie_name ILIKE $1 AND genre ILIKE $2 AND rating >= $3");
    expect(q.params).toEqual(["%dark%", "%Crime%", 7, 10, 0]);
    expect(q.sql).toContain("ORDER BY movie_name ASC NULLS LAST");
  });

  it("bounds votes on both sides", () => {
    // The ceiling is what makes a "Hidden Gems" style query possible: a floor
    // alone still returns the most-voted films, just in a different order.
    const q = buildStructuralQuery({ min_votes: 500, max_votes: 5000, sort_by: "rating", sort_order: "desc", skip: 0, limit: 10 });
    expect(q.whereSql).toBe("WHERE NULLIF(votes, '')::int >= $1 AND NULLIF(votes, '')::int <= $2");
    expect(q.params).toEqual([500, 5000, 10, 0]);
  });
});

describe("structuralService", () => {
  it("returns results with total count", async () => {
    const rows = [{ id: 1, movie_name: "The Dark Knight", rating: 9, runtime: 152 }];
    const db = {
      async query(sql: string) {
        return sql.includes("count(*)") ? { rows: [{ total: 1 }] } : { rows };
      },
    };
    const { results, total } = await structuralService.executeSearch(db, { query: "dark", sort_by: "rating", sort_order: "desc", skip: 0, limit: 10 });
    expect(total).toBe(1);
    expect(results[0]?.movie_name).toBe("The Dark Knight");
  });

  it("splits comma-separated genres into counted facets", async () => {
    const db = fakeDb([{ genre: "Action, Crime" }, { genre: "Crime, Drama" }, { genre: "Drama" }]);
    const genres = await structuralService.getGenres(db);
    expect(genres).toEqual([
      { name: "Crime", count: 2 },
      { name: "Drama", count: 2 },
      { name: "Action", count: 1 },
    ]);
  });

  it("computes stats with fallbacks", async () => {
    const db = fakeDb([{ min_rating: 4.5, max_rating: 9.3, min_runtime: 90, max_runtime: 180, total_movies: 12 }]);
    const stats = await structuralService.getStats(db);
    expect(stats).toEqual({ min_rating: 4.5, max_rating: 9.3, min_runtime: 90, max_runtime: 180, total_movies: 12 });
  });
});