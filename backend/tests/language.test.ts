import { describe, expect, it } from "vitest";
import type { Queryable } from "../src/models.js";
import { buildStructuralQuery, structuralService } from "../src/services/structural.js";
import { buildApp } from "../src/app.js";
import { semanticService } from "../src/services/semantic.js";

/**
 * Language filtering. The data comes from a TMDB backfill into
 * `original_language` (a 2-letter code, nullable for rows the sweep never
 * reached), and the feature exists because a viewer asked not to be shown
 * films they cannot understand.
 *
 * The behaviour worth protecting: language is a HARD filter. Hybrid search
 * relaxes genre/directors/stars when the strict conjunction finds nothing, and
 * language must NOT be part of that relaxation — otherwise asking for French
 * films and getting nothing would quietly return the films the user excluded.
 */

const embed = async (text: string) => [text.length];

function fakeDb(rows: Record<string, unknown>[]): Queryable {
  return {
    async query() {
      return { rows };
    },
  };
}

describe("structural search: language filter", () => {
  it("adds an exact, case-insensitive language condition", () => {
    const q = buildStructuralQuery({
      language: "FR",
      sort_by: "rating",
      sort_order: "desc",
      skip: 0,
      limit: 10,
    });
    expect(q.whereSql).toContain("lower(original_language) = $1");
    expect(q.params).toEqual(["fr", 10, 0]);
  });

  it("omits the condition when no language is requested (so nothing is hidden)", () => {
    const q = buildStructuralQuery({ sort_by: "rating", sort_order: "desc", skip: 0, limit: 10 });
    expect(q.whereSql).not.toContain("original_language");
  });

  it("composes with other filters and keeps positional params aligned", () => {
    const q = buildStructuralQuery({
      genre: "Drama",
      language: "ja",
      min_rating: 7,
      sort_by: "rating",
      sort_order: "desc",
      skip: 0,
      limit: 5,
    });
    expect(q.whereSql).toBe(
      "WHERE genre ILIKE $1 AND rating >= $2 AND lower(original_language) = $3",
    );
    expect(q.params).toEqual(["%Drama%", 7, "ja", 5, 0]);
  });

  it("carries original_language through to the result shape", async () => {
    const db = fakeDb([{ id: 1, movie_name: "Amélie", original_language: "fr" }]);
    const { results } = await structuralService.executeSearch(db, {
      query: undefined,
      language: "fr",
      sort_by: "rating",
      sort_order: "desc",
      skip: 0,
      limit: 10,
    });
    expect(results[0]?.original_language).toBe("fr");
  });

  it("reports an unknown language as null rather than guessing", async () => {
    const db = fakeDb([{ id: 2, movie_name: "Mystery", original_language: null }]);
    const { results } = await structuralService.executeSearch(db, {
      query: undefined,
      sort_by: "rating",
      sort_order: "desc",
      skip: 0,
      limit: 10,
    });
    expect(results[0]?.original_language).toBeNull();
  });
});

describe("language facet", () => {
  it("maps query rows to {code, count} and preserves the most-common-first order", async () => {
    const db = fakeDb([
      { code: "en", count: 17856 },
      { code: "hi", count: 560 },
      { code: "fr", count: 2476 },
    ]);
    const languages = await structuralService.getLanguages(db);
    expect(languages).toEqual([
      { code: "en", count: 17856 },
      { code: "hi", count: 560 },
      { code: "fr", count: 2476 },
    ]);
  });

  it("drops blank codes and non-positive counts", async () => {
    const db = fakeDb([
      { code: "", count: 5 },
      { code: "de", count: 0 },
      { code: "it", count: 1216 },
      { code: null, count: 3 },
    ]);
    expect(await structuralService.getLanguages(db)).toEqual([{ code: "it", count: 1216 }]);
  });
});

describe("hybrid search: language survives relaxation", () => {
  /** Captures every SQL statement so the two runs can be inspected. */
  function capturingDb(): { db: Queryable; sqls: string[] } {
    const sqls: string[] = [];
    const db: Queryable = {
      async query(sql: string) {
        sqls.push(sql);
        if (sql.includes("count(*)")) return { rows: [{ total: 0 }] };
        // The STRICT run (the one carrying genre) finds nothing, which is what
        // triggers the relaxation path. The relaxed run returns a row.
        if (sql.includes("genre ILIKE")) return { rows: [] };
        return {
          rows: [{ id: 1, movie_name: "Le Samouraï", original_language: "fr", similarity_score: 0.6 }],
        };
      },
    };
    return { db, sqls };
  }

  it("applies the language condition on the strict run", async () => {
    const { db, sqls } = capturingDb();
    await semanticService.hybridSearch(
      db,
      { query: "cool hitman", genre: "Crime", language: "fr", limit: 5 },
      embed,
    );
    const strictData = sqls[0] ?? "";
    expect(strictData).toContain("lower(original_language) =");
    expect(strictData).toContain("genre ILIKE");
  });

  it("keeps the language condition even after genre is relaxed away", async () => {
    const { db, sqls } = capturingDb();
    await semanticService.hybridSearch(
      db,
      { query: "cool hitman", genre: "Crime", language: "fr", limit: 5 },
      embed,
    );
    // Relaxation is triggered by a categorical filter returning nothing.
    expect(sqls.length).toBeGreaterThanOrEqual(4);
    const relaxedData = sqls[3] ?? "";
    expect(relaxedData).not.toContain("genre ILIKE"); // genre was dropped...
    expect(relaxedData).toContain("lower(original_language) ="); // ...language was not
  });

  it("does not filter by language when none was requested", async () => {
    const { db, sqls } = capturingDb();
    await semanticService.hybridSearch(db, { query: "cool hitman", limit: 5 }, embed);
    // The column list mentions original_language; the FILTER must not.
    expect(sqls.join(" ")).not.toContain("lower(original_language) =");
  });
});

describe("detail endpoints expose original_language", () => {
  /**
   * Regression: flicks.ts carried three literal copies of the column list, and
   * adding the language column only to the shared MOVIE_COLUMNS left all three
   * of them returning original_language: null. The detail page showed no
   * language while search returned it correctly — a silent, partial rollout.
   * They now import the shared constant; this asserts the SQL they send.
   */
  it("selects the language column on /flicks and /flicks/movie/:id", async () => {
    const sqls: string[] = [];
    const db: Queryable = {
      async query(sql: string) {
        sqls.push(sql);
        return { rows: [] };
      },
    };
    const app = buildApp({ db, embed: async () => [], agentParse: async (q) => ({ query: q, skip: 0, limit: 10 }) });
    await app.ready();
    await app.inject({ method: "GET", url: "/flicks/?limit=5" });
    await app.inject({ method: "GET", url: "/flicks/movie/1" });
    await app.inject({ method: "GET", url: "/flicks/filter?genre=Drama" });
    await app.close();

    expect(sqls.length).toBeGreaterThanOrEqual(3);
    for (const sql of sqls) {
      expect(sql, sql).toContain("original_language");
    }
  });
});

describe("pagination is deterministic", () => {
  /**
   * Regression found by paging a real search in the browser: pages came back
   * 19/18/18/18 instead of 20/20/20/20. `ORDER BY rating DESC NULLS LAST` has
   * no tiebreaker and ratings tie constantly, so Postgres is free to order tied
   * rows differently per query — OFFSET pages then repeat some rows and skip
   * others, and films quietly never appear at all.
   */
  it("breaks rating ties by id so OFFSET pages cannot overlap", () => {
    const q = buildStructuralQuery({ sort_by: "rating", sort_order: "desc", skip: 20, limit: 20 });
    expect(q.sql).toContain("ORDER BY rating DESC NULLS LAST, id ASC");
  });

  it("keeps the tiebreaker for other sort columns and directions", () => {
    for (const sort_by of ["runtime", "movie_name", "metascore", "release_year"] as const) {
      const q = buildStructuralQuery({ sort_by, sort_order: "asc", skip: 0, limit: 20 });
      expect(q.sql, sort_by).toContain(", id ASC");
    }
  });
});
