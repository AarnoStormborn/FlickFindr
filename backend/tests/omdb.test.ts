import { describe, expect, it, vi, afterEach } from "vitest";
import { getRatingsByImdbId, normalizeOmdb, omdbConfigured } from "../src/omdb.js";

/**
 * OMDb's payload is loose: ratings arrive as strings ("9.3", "2,800,000", "N/A"),
 * sections can be missing entirely, and Metascore appears twice. Everything the UI
 * shows is normalised here, so these are the format variants that actually occur.
 */
describe("normalizeOmdb", () => {
  it("reads the common shape", () => {
    const r = normalizeOmdb({
      Response: "True",
      imdbID: "tt0111161",
      imdbRating: "9.3",
      imdbVotes: "2,800,000",
      Metascore: "82",
      Ratings: [
        { Source: "Internet Movie Database", Value: "9.3/10" },
        { Source: "Rotten Tomatoes", Value: "91%" },
        { Source: "Metacritic", Value: "82/100" },
      ],
    });
    expect(r.imdb).toEqual({ score: 9.3, votes: 2_800_000 });
    expect(r.rotten_tomatoes).toEqual({ score: 91 });
    expect(r.metacritic).toEqual({ score: 82 });
    expect(r.imdb_id).toBe("tt0111161");
  });

  it("treats the string N/A as absent rather than zero", () => {
    // Zero would render as "IMDb 0" and read as a terrible film.
    const r = normalizeOmdb({ Response: "True", imdbRating: "N/A", imdbVotes: "N/A", Metascore: "N/A" });
    expect(r.imdb).toBeNull();
    expect(r.metacritic).toBeNull();
  });

  it("falls back to the Ratings array when Metascore is missing", () => {
    const r = normalizeOmdb({ Response: "True", Ratings: [{ Source: "Metacritic", Value: "74/100" }] });
    expect(r.metacritic).toEqual({ score: 74 });
  });

  it("keeps an IMDb score with no vote count", () => {
    const r = normalizeOmdb({ Response: "True", imdbRating: "7.1" });
    expect(r.imdb).toEqual({ score: 7.1, votes: null });
  });

  it("returns empty ratings for a film OMDb knows nothing about", () => {
    const r = normalizeOmdb({ Response: "False", Error: "Movie not found!" });
    expect(r.imdb).toBeNull();
    expect(r.rotten_tomatoes).toBeNull();
    expect(r.metacritic).toBeNull();
  });
});

describe("getRatingsByImdbId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is inert without a key, so the feature degrades instead of failing", async () => {
    vi.stubEnv("OMDB_API_KEY", "");
    expect(omdbConfigured()).toBe(false);
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await getRatingsByImdbId("tt0111161")).toEqual({ ok: false, missing: false, ratings: null });
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a missing film as definitive and a 401 as transient", async () => {
    vi.stubEnv("OMDB_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ Response: "False", Error: "Movie not found!" }) })));
    expect(await getRatingsByImdbId("tt404")).toMatchObject({ ok: true, missing: true });

    // A rejected key (or spent daily quota) must never be recorded as "no ratings".
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    expect(await getRatingsByImdbId("tt0111161")).toMatchObject({ ok: false, missing: false });
  });

  it("returns normalised ratings on success", async () => {
    vi.stubEnv("OMDB_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ Response: "True", imdbRating: "8.8", imdbID: "tt1375666" }) })));
    const res = await getRatingsByImdbId("tt1375666");
    expect(res.ok).toBe(true);
    expect(res.ratings?.imdb?.score).toBe(8.8);
  });
});
