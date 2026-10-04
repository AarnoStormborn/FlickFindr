import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../src/models.js";
import { buildApp } from "../src/app.js";

// Mock only the network-touching layers; the normalisation under test is real.
vi.mock("../src/tmdb.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/tmdb.js")>();
  return { ...actual, getExternalIds: vi.fn(), getMovieVideos: vi.fn().mockResolvedValue({ ok: true, missing: false, videos: [] }) };
});
vi.mock("../src/omdb.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/omdb.js")>();
  return { ...actual, getRatingsByImdbId: vi.fn(), omdbConfigured: vi.fn().mockReturnValue(true) };
});
import { getExternalIds } from "../src/tmdb.js";
import { getRatingsByImdbId, omdbConfigured } from "../src/omdb.js";

/**
 * Third-party ratings on the detail page.
 *
 * The contract worth protecting is the one the trailer loader and watch providers
 * share: `ratings_checked` means "we asked", a transient failure must never be
 * recorded as "this film has no ratings" (it would be a permanent lie), and a film
 * with genuinely no ratings is a 200 with an empty payload rather than an error —
 * the UI should stay quiet, not break.
 */
const SAMPLE = {
  imdb_id: "tt0111161",
  imdb: { score: 9.3, votes: 2_800_000 },
  rotten_tomatoes: { score: 91 },
  metacritic: { score: 82 },
  source: "OMDb" as const,
};

describe("GET /flicks/movie/:id/ratings", () => {
  beforeEach(() => {
    vi.mocked(omdbConfigured).mockReturnValue(true);
    vi.mocked(getExternalIds).mockReset().mockResolvedValue({ ok: true, missing: false, imdbId: "tt0111161" });
    vi.mocked(getRatingsByImdbId).mockReset().mockResolvedValue({ ok: true, missing: false, ratings: SAMPLE });
  });
  afterEach(() => vi.unstubAllGlobals());

  function fakeDb(row: Record<string, unknown> | undefined) {
    const updates: Array<unknown[]> = [];
    const db: Queryable = {
      async query(sql: string, params?: unknown[]) {
        if (sql.startsWith("UPDATE")) {
          updates.push(params ?? []);
          return { rows: [] };
        }
        return { rows: row ? [row] : [] };
      },
    };
    return { db, updates };
  }

  const build = (row: Record<string, unknown> | undefined) => {
    const { db, updates } = fakeDb(row);
    return {
      app: buildApp({ db, embed: async () => [], agentParse: async (q) => ({ query: q, skip: 0, limit: 10 }) }),
      updates,
    };
  };

  const get = async (row: Record<string, unknown> | undefined, url = "/flicks/movie/1/ratings") => {
    const { app, updates } = build(row);
    await app.ready();
    const res = await app.inject({ method: "GET", url });
    await app.close();
    return { res, updates };
  };

  it("serves stored ratings without calling either provider", async () => {
    const { res, updates } = await get({ tmdb_id: 278, external_ratings: SAMPLE, ratings_checked: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().ratings).toEqual(SAMPLE);
    // Attribution is part of the deal with the data sources.
    expect(res.json().attribution.text).toMatch(/imdb|omdb/i);
    expect(getExternalIds).not.toHaveBeenCalled();
    expect(getRatingsByImdbId).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("fetches on the first visit and caches the answer", async () => {
    const { res, updates } = await get({ tmdb_id: 278, external_ratings: null, ratings_checked: false });
    expect(res.statusCode).toBe(200);
    expect(res.json().ratings).toEqual(SAMPLE);
    expect(getExternalIds).toHaveBeenCalledWith(278, 4);
    expect(getRatingsByImdbId).toHaveBeenCalledWith("tt0111161", 4);
    expect(updates).toHaveLength(1);
    expect(String(updates[0]?.[0])).toContain("tt0111161");
  });

  it("never records a transient failure as 'no ratings'", async () => {
    vi.mocked(getRatingsByImdbId).mockResolvedValue({ ok: false, missing: false, ratings: null });
    const { res, updates } = await get({ tmdb_id: 278, external_ratings: null, ratings_checked: false });
    expect(res.statusCode).toBe(503);
    expect(updates).toHaveLength(0); // the row stays unchecked, so it retries later
  });

  it("records a film OMDb does not know as checked-with-nothing", async () => {
    // A definitive "not found" is an answer, and re-asking forever is the bug the
    // 404 handling elsewhere exists to avoid.
    vi.mocked(getRatingsByImdbId).mockResolvedValue({ ok: true, missing: true, ratings: null });
    const { res, updates } = await get({ tmdb_id: 278, external_ratings: null, ratings_checked: false });
    expect(res.statusCode).toBe(200);
    expect(res.json().ratings).toBeNull();
    expect(updates).toHaveLength(1);
  });

  it("handles a film with no IMDb id without calling OMDb", async () => {
    vi.mocked(getExternalIds).mockResolvedValue({ ok: true, missing: false, imdbId: null });
    const { res, updates } = await get({ tmdb_id: 278, external_ratings: null, ratings_checked: false });
    expect(res.statusCode).toBe(200);
    expect(res.json().ratings).toBeNull();
    expect(getRatingsByImdbId).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
  });

  it("says so when the feature is not configured, instead of claiming no ratings", async () => {
    vi.mocked(omdbConfigured).mockReturnValue(false);
    const { res, updates } = await get({ tmdb_id: 278, external_ratings: null, ratings_checked: false });
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).toMatch(/not configured/i);
    expect(updates).toHaveLength(0);
  });

  it("returns 404 for an unknown movie and 400 for a malformed id", async () => {
    expect((await get(undefined)).res.statusCode).toBe(404);
    const { res } = await get({ tmdb_id: 1 }, "/flicks/movie/abc/ratings");
    expect(res.statusCode).toBe(400);
  });
});
