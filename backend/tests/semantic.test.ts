import { describe, expect, it } from "vitest";
import type { Queryable } from "../src/models.js";
import { SIMILARITY_THRESHOLD, semanticService } from "../src/services/semantic.js";

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
    expect(sql).toContain("ORDER BY plot_embedding <=> CAST($1 AS vector)");
    expect(result.exact_matches).toBe(true);
    expect(result.movies[0]?.movie_name).toBe("Inception");
  });

  it("threshold constant is 0.6", () => {
    expect(SIMILARITY_THRESHOLD).toBe(0.6);
  });
});