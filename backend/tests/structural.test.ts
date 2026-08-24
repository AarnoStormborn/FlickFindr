import { describe, expect, it } from "vitest";
import type { Queryable } from "../src/models.js";
import { buildStructuralQuery, structuralService } from "../src/services/structural.js";

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
    expect(q.sql).toContain("ORDER BY rating DESC NULLS LAST");
    expect(q.sql).toContain("LIMIT $1 OFFSET $2");
    expect(q.whereSql).toBe("");
    expect(q.params).toEqual([20, 5]);
  });

  it("appends filters with positional params", () => {
    const q = buildStructuralQuery({ query: "dark", genre: "Crime", min_rating: 7, sort_by: "movie_name", sort_order: "asc", skip: 0, limit: 10 });
    expect(q.whereSql).toBe("WHERE movie_name ILIKE $1 AND genre ILIKE $2 AND rating >= $3");
    expect(q.params).toEqual(["%dark%", "%Crime%", 7, 10, 0]);
    expect(q.sql).toContain("ORDER BY movie_name ASC NULLS LAST");
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