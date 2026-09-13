import { describe, expect, it, vi } from "vitest";
import { buildChatTools, extractMovieRows, maxSuggestionsFor, toAgentRow } from "../src/agent/chat.js";

/**
 * Regression guard for a bug that only showed up live: `structuralService`
 * returns `{ results }` while `semanticService` returns `{ movies }`. Reading
 * just one key meant semantic/hybrid searches never produced any movie cards,
 * so the concierge answered in prose with an empty result strip.
 */
describe("extractMovieRows", () => {
  const movie = { id: 1, movie_name: "Alien" };

  it("reads the structural shape ({ results })", () => {
    expect(extractMovieRows({ results: [movie], total: 1 })).toEqual([movie]);
  });

  it("reads the semantic/hybrid shape ({ movies })", () => {
    expect(extractMovieRows({ movies: [movie], total: 1, exact_matches: false, message: "" })).toEqual([movie]);
  });

  it("accepts a bare array", () => {
    expect(extractMovieRows([movie])).toEqual([movie]);
  });

  it("prefers results when both keys exist", () => {
    const other = { id: 2, movie_name: "Aliens" };
    expect(extractMovieRows({ results: [movie], movies: [other] })).toEqual([movie]);
  });

  it("returns an empty array for unusable shapes", () => {
    for (const input of [undefined, null, 42, "nope", {}, { results: "not-an-array" }, { movies: null }]) {
      expect(extractMovieRows(input)).toEqual([]);
    }
  });
});

describe("buildChatTools movie surfacing", () => {
  const row = {
    id: 7,
    movie_name: "Primer",
    release_year: 2004,
    rating: 6.7,
    runtime: 77,
    genre: "Drama",
    poster_url: null,
  };

  /**
   * Tool `execute` takes (id, params, signal, onUpdate, ctx); production tools
   * ignore the trailing args, so tests call it directly.
   */
  const run = (tool: { execute: unknown }, params: unknown) =>
    (tool.execute as (id: string, p: unknown) => Promise<unknown>)("call-1", params);

  /** Minimal db stub: returns rows for SELECTs, empty for counts. */
  function fakeDb(rows: unknown[]) {
    return {
      query: vi.fn(async (sql: string) =>
        sql.includes("count(") ? { rows: [{ total: rows.length }] } : { rows },
      ),
    } as never;
  }

  it("surfaces structural search results as chat movies", async () => {
    const seen: unknown[] = [];
    const tools = buildChatTools(fakeDb([row]), async () => [], (m) => seen.push(m));
    const tool = tools.find((t) => t.name === "search_movies")!;

    await run(tool, { genre: "Drama", limit: 5 });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([
      { id: 7, movie_name: "Primer", release_year: 2004, rating: 6.7, runtime: 77, genre: "Drama", poster_url: null },
    ]);
  });

  it("accepts string ids (pg returns bigint columns as strings)", async () => {
    const seen: unknown[] = [];
    const tools = buildChatTools(fakeDb([{ ...row, id: "7" }]), async () => [], (m) => seen.push(m));
    const tool = tools.find((t) => t.name === "search_movies")!;

    await run(tool, { limit: 5 });

    expect((seen[0] as { id: unknown }[])[0]!.id).toBe(7);
  });

  it("does not surface when no callback is supplied", async () => {
    const tools = buildChatTools(fakeDb([row]), async () => []);
    const tool = tools.find((t) => t.name === "search_movies")!;
    await expect(run(tool, { limit: 5 })).resolves.toBeTruthy();
  });
});

describe("toAgentRow", () => {
  const full = {
    id: 1,
    movie_name: "Alien",
    release_year: 1979,
    rating: 8.5,
    runtime: 117,
    genre: "Horror, Sci-Fi",
    plot: "x".repeat(500),
    directors: "Ridley Scott",
    stars: "Sigourney Weaver",
    votes: "1.2M",
    gross: "80.9M",
    poster_url: "https://example.com/a.jpg",
    similarity_score: 0.9,
  };

  it("drops the fields an agent does not need to decide", () => {
    const row = toAgentRow(full);
    for (const dropped of ["directors", "stars", "votes", "gross", "poster_url", "similarity_score"]) {
      expect(row).not.toHaveProperty(dropped);
    }
  });

  it("keeps the deciding fields", () => {
    expect(toAgentRow(full)).toMatchObject({
      id: 1,
      movie_name: "Alien",
      release_year: 1979,
      rating: 8.5,
      runtime: 117,
      genre: "Horror, Sci-Fi",
    });
  });

  it("truncates long plots to a gist", () => {
    const plot = toAgentRow(full).plot as string;
    expect(plot.length).toBeLessThanOrEqual(201);
    expect(plot.endsWith("\u2026")).toBe(true);
  });

  it("keeps short plots intact", () => {
    expect(toAgentRow({ ...full, plot: "A short one." }).plot).toBe("A short one.");
  });

  it("tolerates missing and null fields", () => {
    expect(toAgentRow({ id: 2, movie_name: "X", plot: null })).toMatchObject({
      id: 2,
      movie_name: "X",
      release_year: null,
      rating: null,
      runtime: null,
      genre: null,
      plot: null,
    });
  });

  it("materially shrinks a search payload", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...full, id: i }));
    const before = JSON.stringify(rows).length;
    const after = JSON.stringify(rows.map((r) => toAgentRow(r))).length;
    expect(after).toBeLessThan(before * 0.6);
  });
});

describe("maxSuggestionsFor", () => {
  it("defaults to six", () => {
    expect(maxSuggestionsFor("a cozy rainy sunday film")).toBe(6);
    expect(maxSuggestionsFor("")).toBe(6);
    expect(maxSuggestionsFor(undefined as unknown as string)).toBe(6);
  });

  it("ignores numbers that are not a count", () => {
    // Runtimes and years are not requests for a longer list.
    expect(maxSuggestionsFor("a heist film under 2 hours")).toBe(6);
    expect(maxSuggestionsFor("something from 1999")).toBe(6);
    expect(maxSuggestionsFor("a movie under 120 minutes")).toBe(6);
  });

  it("honours an explicit count paired with a quantity word", () => {
    expect(maxSuggestionsFor("show me 10 movies")).toBe(10);
    expect(maxSuggestionsFor("give me 8 film options")).toBe(8);
    expect(maxSuggestionsFor("recommend 12 titles")).toBe(12);
  });

  it("honours a request verb followed by a count", () => {
    expect(maxSuggestionsFor("show me 9")).toBe(9);
    expect(maxSuggestionsFor("list 7 please")).toBe(7);
  });

  it("caps at twelve", () => {
    expect(maxSuggestionsFor("show me 50 movies")).toBe(12);
  });

  it("treats requests for more as the maximum", () => {
    for (const m of ["more options", "any others?", "show me additional picks", "got anything extra"]) {
      expect(maxSuggestionsFor(m)).toBe(12);
    }
  });

  it("does not raise the cap for a count at or below the default", () => {
    expect(maxSuggestionsFor("show me 3 movies")).toBe(6);
  });
});
