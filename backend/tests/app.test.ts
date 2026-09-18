import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { HybridSearchRequest, Queryable } from "../src/models.js";

async function fakeDb(): Promise<Queryable> {
  return {
    async query(sql: string) {
      if (sql.includes("min(rating)")) {
        return { rows: [{ min_rating: 4, max_rating: 9, min_runtime: 80, max_runtime: 200, total_movies: 2 }] };
      }
      if (sql.includes("count(*)")) return { rows: [{ total: 1 }] };
      if (sql.trimStart().startsWith("SELECT genre FROM")) {
        return { rows: [{ genre: "Action, Crime" }, { genre: "Drama" }] };
      }
      return {
        rows: [
          {
            id: 1,
            movie_name: "The Dark Knight",
            rating: 9,
            runtime: 152,
            genre: "Action, Crime",
            metascore: 84,
            plot: "Batman battles the Joker.",
            directors: "Christopher Nolan",
            stars: "Christian Bale",
            votes: "2.7M",
            gross: "534.9M",
            poster_url: "https://example.com/p.jpg",
            similarity_score: 0.9,
          },
        ],
      };
    },
  };
}

const agentParse = async (query: string): Promise<HybridSearchRequest> => ({
  query,
  skip: 0,
  limit: 10,
  genre: "Action",
});

describe("FlickFindr API (injected deps)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      db: await fakeDb(),
      embed: async (t) => [t.length],
      agentParse,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET / returns health message and agent status", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message).toBe("API is running !!!");
    // `configured` depends on the environment's credentials, so assert only
    // the contract clients rely on: the field is present and boolean.
    expect(typeof body.agent?.enabled).toBe("boolean");
    expect(typeof body.agent?.configured).toBe("boolean");
  });

  it("GET /flicks/ lists movies", async () => {
    const res = await app.inject({ method: "GET", url: "/flicks/" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0]?.movie_name).toBe("The Dark Knight");
  });

  it("GET /flicks/movie/1 returns one movie", async () => {
    const res = await app.inject({ method: "GET", url: "/flicks/movie/1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(1);
  });

  it("GET /flicks/movie/:id/similar returns a results array", async () => {
    const res = await app.inject({ method: "GET", url: "/flicks/movie/1/similar?limit=5" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("GET /flicks/movie/:id/trailers returns empty results (no tmdb_id in fixture)", async () => {
    const res = await app.inject({ method: "GET", url: "/flicks/movie/1/trailers" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(0);
  });

  it("POST /search/structural returns paginated response", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/search/structural",
      payload: { query: "dark", limit: 10, skip: 0 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.has_more).toBe(false);
  });

  it("POST /search/structural rejects bad payloads", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/search/structural",
      payload: { limit: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /search/genres returns faceted genres", async () => {
    const res = await app.inject({ method: "GET", url: "/search/genres" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.some((g: { name: string }) => g.name === "Crime")).toBe(true);
  });

  it("GET /search/stats returns extents", async () => {
    const res = await app.inject({ method: "GET", url: "/search/stats" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total_movies).toBe(2);
  });

  it("POST /search/semantic uses the agent-interpreted query", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/search/semantic",
      payload: { query: "a dark superhero movie", limit: 10 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.exact_matches).toBe(true);
    expect(body.message).toContain("Movies found");
  });

  it("POST /search/hybrid merges agent filters with request filters", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/search/hybrid",
      payload: { query: "dream heist", limit: 5 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("POST /chat keeps the CORS headers on the SSE response", async () => {
    // The SSE route writes headers via reply.raw.writeHead(), which replaces
    // the whole header set. Without carrying over what @fastify/cors set, the
    // chat works from curl and same-origin but is blocked by the browser for
    // any cross-origin frontend (Vercel -> Render) — a production-only break.
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: { origin: "http://localhost:5173" },
      payload: { message: "hi" },
    });
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

    describe("input validation on /flicks (security)", () => {
        /**
         * These routes coerced query params with Number() and had no bounds, so
         * `?limit=100000` returned the entire catalogue in one response (30,749
         * rows measured) and malformed values reached Postgres and surfaced as
         * 500s (`?skip=abc`, `?limit=-5`, `/flicks/movie/abc`).
         */
        it("rejects an unbounded limit instead of returning the whole catalogue", async () => {
            const res = await app.inject({ method: "GET", url: "/flicks/?limit=100000" });
            expect(res.statusCode).toBe(400);
            expect(res.json().detail).toMatch(/100/);
        });

        it("accepts a limit within bounds", async () => {
            expect((await app.inject({ method: "GET", url: "/flicks/?limit=20&skip=0" })).statusCode).toBe(200);
        });

        it("rejects malformed and negative pagination with 400, not 500", async () => {
            for (const url of ["/flicks/?skip=abc", "/flicks/?limit=abc", "/flicks/?limit=-5", "/flicks/?skip=-1"]) {
                const res = await app.inject({ method: "GET", url });
                expect(res.statusCode, url).toBe(400);
            }
        });

        it("rejects a non-numeric or out-of-range movie id with 400", async () => {
            for (const url of ["/flicks/movie/abc", "/flicks/movie/0", "/flicks/movie/-1", "/flicks/movie/99999999999999999999"]) {
                const res = await app.inject({ method: "GET", url });
                expect(res.statusCode, url).toBe(400);
            }
        });

        it("bounds the similar-movies limit", async () => {
            expect((await app.inject({ method: "GET", url: "/flicks/movie/1/similar?limit=999999" })).statusCode).toBe(400);
        });

        it("bounds filter pagination and rejects oversized filter values", async () => {
            expect((await app.inject({ method: "GET", url: "/flicks/filter?limit=99999" })).statusCode).toBe(400);
            expect((await app.inject({ method: "GET", url: `/flicks/filter?genre=${"a".repeat(101)}` })).statusCode).toBe(400);
            expect((await app.inject({ method: "GET", url: "/flicks/filter?genre=Drama&limit=10" })).statusCode).toBe(200);
        });
    });

    describe("rate limiting (the API is public and /chat spends money)", () => {
        it("advertises a limit on ordinary responses", async () => {
            const res = await app.inject({ method: "GET", url: "/flicks/?limit=5" });
            // Presence of these headers is proof the plugin is registered and
            // counting, without having to hammer the endpoint.
            expect(res.headers["x-ratelimit-limit"]).toBeDefined();
            expect(Number(res.headers["x-ratelimit-limit"])).toBeGreaterThan(0);
        });

        it("rejects a burst on /chat with 429 once the limit is passed", async () => {
            // /chat has the strictest limit (8/min default) because each turn is
            // several model calls. Declared last: it deliberately exhausts the
            // bucket for this app instance.
            const codes: number[] = [];
            for (let i = 0; i < 12; i++) {
                const res = await app.inject({ method: "POST", url: "/chat", payload: { message: "hi" } });
                codes.push(res.statusCode);
            }
            expect(codes[0]).not.toBe(429); // normal use is allowed first
            expect(codes).toContain(429); // and a burst is stopped
        });
    });

    describe("pagination depth is capped (MAX_RESULTS)", () => {
        it("accepts a page that lands inside the top 100", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/search/structural",
                payload: { limit: 20, skip: 80 },
            });
            expect(res.statusCode).toBe(200);
        });

        it("rejects a skip beyond the cap instead of serving a 30k-deep page", async () => {
            for (const url of ["/search/structural", "/search/semantic", "/search/hybrid"]) {
                const res = await app.inject({ method: "POST", url, payload: { query: "a heist film", limit: 20, skip: 100 } });
                expect(res.statusCode, url).toBe(400);
                expect(JSON.stringify(res.json())).toMatch(/first 100 results/);
            }
        });

        it("still allows the maximum page size from the very start", async () => {
            const res = await app.inject({ method: "POST", url: "/search/structural", payload: { limit: 100, skip: 0 } });
            expect(res.statusCode).toBe(200);
        });
    });
});
