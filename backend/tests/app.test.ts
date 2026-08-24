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

  it("GET / returns health message", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message: "API is running !!!" });
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
});