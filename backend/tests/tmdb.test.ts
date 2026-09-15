import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTmdbCache,
  getMovieVideos,
  trailerScore,
} from "../src/tmdb.js";

/**
 * The trailer-selection logic runs at ~9% coverage yet decides what every
 * trailer button shows: it is what keeps an ASL version, a Short, or a Comic-Con
 * first look from becoming the stored trailer. These tests pin that behaviour.
 */

const OFFICIAL = {
  key: "abc",
  name: "Inception - Official Trailer",
  type: "Trailer",
  site: "YouTube",
  official: true,
  size: 1080,
  iso_639_1: "en",
  iso_3166_1: "US",
  published_at: "2010-05-10",
} as never;

const video = (over: Record<string, unknown>) => ({ ...(OFFICIAL as Record<string, unknown>), ...over }) as never;

describe("trailerScore", () => {
  it("prefers an official high-res English-US trailer", () => {
    expect(trailerScore(OFFICIAL)).toBeGreaterThan(trailerScore(video({ official: false })));
    expect(trailerScore(OFFICIAL)).toBeGreaterThan(
      trailerScore(video({ size: 480, iso_3166_1: undefined })),
    );
  });

  it("ranks a trailer above a teaser", () => {
    expect(trailerScore(video({ type: "Trailer" }))).toBeGreaterThan(
      trailerScore(video({ type: "Teaser", name: "Teaser spot" })),
    );
  });

  it("penalises teasers typed as 'Trailer'", () => {
    expect(trailerScore(video({ type: "Trailer", name: "Official teaser trailer" }))).toBeLessThan(
      trailerScore(video({ type: "Trailer", name: "Official trailer" })),
    );
  });

  it("rewards an 'official trailer' name and latest-looking entries", () => {
    expect(trailerScore(video({ name: "Final trailer" }))).toBeGreaterThan(
      trailerScore(video({ name: "Trailer A" })),
    );
    expect(trailerScore(video({ name: "The official trailer is here" }))).toBeGreaterThan(
      trailerScore(video({ name: "Some upload" })),
    );
  });

  it("penalises marketing noise (Shorts, spots, featurettes, Comic-Con)", () => {
    for (const name of [
      "Official Trailer #shorts",
      "Comic-Con first look",
      "In cinemas now spot",
      "Behind the scenes featurette",
      "Book your tickets now",
    ]) {
      expect(trailerScore(video({ name })), name).toBeLessThan(trailerScore(video({ name: "Official trailer" })));
    }
  });

  it("rewards higher resolution", () => {
    expect(trailerScore(video({ size: 2160 }))).toBeGreaterThan(trailerScore(video({ size: 1080 })));
    expect(trailerScore(video({ size: 1080 }))).toBeGreaterThan(trailerScore(video({ size: 720 })));
    expect(trailerScore(video({ size: 720 }))).toBeGreaterThan(trailerScore(video({ size: 480 })));

  });

  it("tolerates missing optional fields", () => {
    expect(() =>
      trailerScore({ key: "k", name: "", type: "", site: "YouTube" } as never),
    ).not.toThrow();
  });
});

describe("getMovieVideos", () => {
  const key = "tmdb-key";
  const api = "https://api.themoviedb.org/3/movie/42/videos?api_key=tmdb-key&language=en-US";

  beforeEach(() => {
    vi.stubEnv("TMDB_API_KEY", key);
    clearTmdbCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearTmdbCache();
  });

  const fetchMock = (results: unknown, ok = true, status = 200) =>
    vi.fn(async (url: unknown) => {
      const expected = new URL(api);
      const seen = new URL(String(url));
      if (seen.origin + seen.pathname !== expected.origin + expected.pathname) {
        throw new Error(`unexpected TMDB URL: ${url}`);
      }
      return {
        ok,
        status,
        json: async () => ({ results }),
      };
    });

  it("orders candidates best-first", async () => {
    vi.stubGlobal("fetch", fetchMock([
      video({ key: "teaser", type: "Teaser", name: "Teaser", published_at: "2009-12-20" }),
      video({ key: "main", name: "Official trailer", published_at: "2010-05-10" }),
      video({ key: "old", name: "Trailer", published_at: "2009-08-10", official: false }),
    ]));
    const { ok, videos } = await getMovieVideos(42);
    expect(ok).toBe(true);
    expect(videos.map((v) => v.key)).toEqual(["main", "old", "teaser"]);
  });

  it("uses the latest upload as the tie-break", async () => {
    vi.stubGlobal("fetch", fetchMock([
      video({ key: "first", name: "Trailer", published_at: "2010-01-01" }),
      video({ key: "second", name: "Trailer", published_at: "2010-06-01" }),
    ]));
    const { videos } = await getMovieVideos(42);
    expect(videos.map((v) => v.key)).toEqual(["second", "first"]);
  });

  it("hard-skips sign-language versions and shorts, and non-Trailer/Teaser entries", async () => {
    vi.stubGlobal("fetch", fetchMock([
      video({ key: "asl", name: "Official Trailer (ASL)" }),
      video({ key: "sign", name: "Trailer with sign language" }),
      video({ key: "bts", type: "Behind the Scenes", name: "Making of" }),
      video({ key: "vimeo", site: "Vimeo" }),
      { ...(video({}) as unknown as Record<string, unknown>), key: undefined },
      video({ key: "good" }),
    ]));
    const { ok, videos } = await getMovieVideos(42);
    expect(ok).toBe(true);
    expect(videos.map((v) => v.key)).toEqual(["good"]);
  });

  it("reports ok=false and caches nothing when TMDB is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    expect(await getMovieVideos(42)).toEqual({ ok: false, videos: [] });
    // A later success must not be masked by the failure.
    vi.stubGlobal("fetch", fetchMock([video({ key: "good" })]));
    expect((await getMovieVideos(42)).videos.map((v) => v.key)).toEqual(["good"]);
  });

  it("reports ok=false on an HTTP error instead of crashing", async () => {
    vi.stubGlobal("fetch", fetchMock([], false, 429));
    expect(await getMovieVideos(42)).toEqual({ ok: false, videos: [] });
  });

  it("returns an empty list (ok=true) when no trailer exists", async () => {
    vi.stubGlobal("fetch", fetchMock([]));
    expect(await getMovieVideos(42)).toEqual({ ok: true, videos: [] });
  });

  it("caches successful lookups per movie id", async () => {
    const fetchFn = fetchMock([video({ key: "good" })]);
    vi.stubGlobal("fetch", fetchFn);
    await getMovieVideos(42);
    await getMovieVideos(42);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await getMovieVideos(43);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("refuses to call TMDB without an API key", async () => {
    vi.stubEnv("TMDB_API_KEY", "");
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    expect(await getMovieVideos(42)).toEqual({ ok: false, videos: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
