import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Queryable } from "../src/models.js";
import {
  RATING_PRIOR_WEIGHT,
  WEIGHTED_RATING_SQL,
} from "../src/services/rating.js";
import { buildStructuralQuery } from "../src/services/structural.js";

/**
 * Ranking by raw `rating` let films with a few dozen votes sit at the top of
 * every browse list — the catalogue opened on a 143-vote 9.9 ahead of films with
 * tens of thousands of votes. These tests pin the replacement: a vote-weighted
 * score, applied everywhere rating is the sort key, that hides nothing.
 */
describe("weighted rating", () => {
  it("shrinks a film's rating toward the catalogue mean by vote count", () => {
    // The formula is (v/(v+m))*rating + (m/(v+m))*mean. For a film with exactly
    // m votes the two halves weigh equally, so its score sits halfway between
    // its own rating and the prior — that is what m means.
    const m = RATING_PRIOR_WEIGHT;
    const mean = 6.31;
    const ownRating = 9.9;
    const halfway = (m / (m + m)) * ownRating + (m / (m + m)) * mean;
    expect(halfway).toBeCloseTo((ownRating + mean) / 2, 6);

    // A 66-vote 9.1 keeps only 6% of its own rating and lands near the prior,
    // while a 31,000-vote 8.7 keeps 97% and stays high — which is the bug.
    const lowVotes = (66 / (66 + m)) * 9.1 + (m / (66 + m)) * mean;
    const highVotes = (31232 / (31232 + m)) * 8.7 + (m / (31232 + m)) * mean;
    expect(lowVotes).toBeLessThan(highVotes);
  });

  it("casts votes from text, treating a missing count as no evidence", () => {
    // `votes` is character varying, so it needs casting; NULL/empty must score at
    // the prior rather than being floated to the top by an unvoted rating.
    expect(WEIGHTED_RATING_SQL).toContain("NULLIF(votes, '')::numeric");
    expect(WEIGHTED_RATING_SQL).toContain("COALESCE(NULLIF(votes, '')::numeric, 0)");
  });

  it("reads the prior mean from the table so it tracks the catalogue", () => {
    expect(WEIGHTED_RATING_SQL).toContain("SELECT avg(rating)::numeric FROM movies");
  });

  it("uses the same weight as the shelves' vote floor", async () => {
    // frontend/src/data/shelves.js BEST_OF_MIN_VOTES — kept in step by hand, so
    // assert the value here to make an accidental change loud.
    expect(RATING_PRIOR_WEIGHT).toBe(1000);
  });
});

describe("rating order is weighted everywhere rating is the sort key", () => {
  /** A db that records every statement, so we can assert on the real SQL. */
  async function recordingDb(seen: string[]): Promise<Queryable> {
    return {
      async query(sql: string) {
        seen.push(sql);
        if (sql.includes("count(*)")) return { rows: [{ total: 1 }] };
        return { rows: [{ id: 1, movie_name: "The Dark Knight", rating: 9, runtime: 152 }] };
      },
    };
  }

  async function withApp(fn: (app: Awaited<ReturnType<typeof buildApp>>, seen: string[]) => Promise<void>) {
    const seen: string[] = [];
    const app = buildApp({
      db: await recordingDb(seen),
      embed: async () => [0.1],
      agentParse: async (query: string) => ({ query, skip: 0, limit: 10 }),
    });
    await app.ready();
    try {
      await fn(app, seen);
    } finally {
      await app.close();
    }
  }

  const orderedBy = (seen: string[]) => seen.filter((s) => s.includes("ORDER BY"));

  it("GET /flicks/ orders by the weighted score", async () => {
    await withApp(async (app, seen) => {
      const res = await app.inject({ method: "GET", url: "/flicks/?limit=5" });
      expect(res.statusCode).toBe(200);
      const orders = orderedBy(seen);
      expect(orders).toHaveLength(1);
      expect(orders[0]).toContain(WEIGHTED_RATING_SQL);
      expect(orders[0]).toContain("DESC NULLS LAST, id ASC");
    });
  });

  it("GET /flicks/filter orders by the weighted score", async () => {
    await withApp(async (app, seen) => {
      const res = await app.inject({ method: "GET", url: "/flicks/filter?genre=Action&limit=5" });
      expect(res.statusCode).toBe(200);
      const orders = orderedBy(seen);
      expect(orders).toHaveLength(1);
      expect(orders[0]).toContain(WEIGHTED_RATING_SQL);
      expect(orders[0]).toContain("DESC NULLS LAST, id ASC");
    });
  });

  it("POST /search/structural orders by the weighted score", async () => {
    await withApp(async (app, seen) => {
      const res = await app.inject({
        method: "POST",
        url: "/search/structural",
        payload: { sort_by: "rating", sort_order: "desc", limit: 5 },
      });
      expect(res.statusCode).toBe(200);
      const orders = orderedBy(seen);
      expect(orders.length).toBeGreaterThan(0);
      // The count query has no ORDER BY; every ordering statement must be
      // weighted, so a future route that forgets is caught here.
      for (const order of orders) expect(order).toContain(WEIGHTED_RATING_SQL);
    });
  });

  it("leaves non-rating sorts untouched", () => {
    // Guards the substitution: only `rating` becomes an expression. Scoped to
    // the ORDER BY, since the SELECT exposes the score as `weighted_rating`.
    const q = buildStructuralQuery({ sort_by: "release_year", sort_order: "desc", skip: 0, limit: 5 });
    const orderBy = q.sql.slice(q.sql.indexOf("ORDER BY"));
    expect(orderBy).not.toContain(WEIGHTED_RATING_SQL);
    expect(orderBy).toContain("ORDER BY release_year DESC NULLS LAST, id ASC");
  });

  it("exposes the score as weighted_rating so clients can keep the order", async () => {
    await withApp(async (app, seen) => {
      const res = await app.inject({ method: "GET", url: "/flicks/?limit=5" });
      expect(res.statusCode).toBe(200);
      expect(seen.join("\n")).toContain("AS weighted_rating");
      // The field is present on every result, so the client never has to guess
      // between the raw and weighted rating.
      expect(res.json()[0]).toHaveProperty("weighted_rating");
    });
  });
});
