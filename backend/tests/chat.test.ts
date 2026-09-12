import { describe, expect, it, vi } from "vitest";
import { buildChatTools, extractMovieRows } from "../src/agent/chat.js";

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
