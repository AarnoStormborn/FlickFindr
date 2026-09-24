import { describe, expect, it } from "vitest";
import type { Queryable } from "../src/models.js";
import { POPULARITY_WEIGHT, SIMILARITY_THRESHOLD, semanticService } from "../src/services/semantic.js";

const embed = async (text: string) => [text.length]; // stub embedding

function dbWith(rows: Record<string, unknown>[]): Queryable {
  let call = 0;
  return {
    async query(sql: string) {
      call += 1;
      return { rows: call === 1 ? rows : [] };
    },
  };
}

describe("semanticService.semanticSearch", () => {
  it("flags exact matches at/above the threshold", async () => {
    const db = dbWith([
      { id: 1, movie_name: "The Shawshank Redemption", similarity_score: 0.82 },
      { id: 2, movie_name: "Escape Plan", similarity_score: 0.55 },
    ]);
    const result = await semanticService.semanticSearch(db, { query: "prison escape friendship", limit: 10 }, embed);
    expect(result.exact_matches).toBe(true);
    expect(result.message).toBe("Movies found matching your query");
    expect(result.movies[0]?.similarity_score).toBe(0.82);
  });

  it("falls back to similar suggestions below the threshold", async () => {
    const db = dbWith([
      { id: 1, movie_name: "Something Else", similarity_score: 0.4 },
    ]);
    const result = await semanticService.semanticSearch(db, { query: "a movie about x", limit: 10 }, embed);
    expect(result.exact_matches).toBe(false);
    expect(result.message).toContain("similar");
  });

  it("reports no movies when the catalog has no hits", async () => {
    const db = dbWith([]);
    const result = await semanticService.semanticSearch(db, { query: "xyz", limit: 10 }, embed);
    expect(result.message).toBe("No movies found");
  });
});

describe("semanticService.hybridSearch", () => {
  it("applies filters into the pgvector WHERE clause", async () => {
    let sql = "";
    const db: Queryable = {
      async query(s: string) {
        sql = s;
        return { rows: [{ id: 3, movie_name: "Inception", similarity_score: 0.7 }] };
      },
    };
    const result = await semanticService.hybridSearch(
      db,
      { query: "dream heist", genre: "Sci-Fi", min_rating: 8, limit: 5 },
      embed,
    );
    expect(sql).toContain("genre ILIKE");
    expect(sql).toContain("rating >= ");
    // Ordered by similarity plus the prominence prior, not bare distance: a plot
    // that merely restates the query must not outrank the film it describes.
    expect(sql).toContain("1 - (plot_embedding <=> CAST($1 AS vector))");
    expect(sql).toContain("DESC, id ASC");
    expect(result.exact_matches).toBe(true);
    expect(result.movies[0]?.movie_name).toBe("Inception");
  });

  it("threshold constant is 0.6", () => {
    expect(SIMILARITY_THRESHOLD).toBe(0.6);
  });
});

/**
 * The prominence prior exists because ranking on cosine similarity alone let a
 * plot that literally restated the query beat the famous film it described (a
 * 61-vote film outranked Harry Potter). These pin the properties that make it
 * safe rather than pinning the exact number, which the eval set owns.
 */
describe("prominence prior", () => {
  it("boosts by a bounded, log-scaled vote term", async () => {
    const statements: string[] = [];
    const db: Queryable = {
      async query(statement: string) {
        statements.push(statement);
        return { rows: [] };
      },
    };
    await semanticService.semanticSearch(db, { query: "a heist", limit: 5, skip: 0 }, embed);
    const sql = statements.find((s) => s.includes("ORDER BY")) ?? "";

    // Log-scaled with a ceiling: prominence must not be able to grow without
    // bound, or the most-voted film in the catalogue wins every query.
    expect(sql).toContain("LEAST(1.0");
    expect(sql).toContain("ln((1 + COALESCE(NULLIF(votes, '')::int, 0))::numeric)");
    // Descending on the combined score, with the id tiebreak kept for paging.
    expect(sql).toMatch(/ORDER BY \(1 - \(plot_embedding <=> CAST\(\$1 AS vector\)\).*\) DESC, id ASC/s);
  });

  it("stays below the weight where long-tail retrieval collapses", () => {
    // Measured with `npm run eval:relevance`: a 237-vote film that a precise
    // query describes holds rank 7 unweighted and at 0.12, slips to 9th at 0.2,
    // and leaves the top ten at 0.25. Kept with margin under that cliff.
    expect(POPULARITY_WEIGHT).toBeGreaterThan(0);
    expect(POPULARITY_WEIGHT).toBeLessThanOrEqual(0.2);
  });
});