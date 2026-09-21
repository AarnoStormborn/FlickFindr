import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../src/models.js";
import { normalizeWatchProviders } from "../src/tmdb.js";
import { buildApp } from "../src/app.js";

// Mock only the network-touching part; keep the real normalisation so the
// tests exercise the actual shaping code.
vi.mock("../src/tmdb.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/tmdb.js")>();
  return {
    ...actual,
    getWatchProviders: vi.fn(),
    getMovieVideos: vi.fn().mockResolvedValue({ ok: true, videos: [] }),
  };
});
import { getWatchProviders } from "../src/tmdb.js";

/**
 * Where to watch.
 *
 * Two things are worth protecting here beyond "it renders": we store only the
 * regions we serve out of ~112 TMDB returns, and a failed TMDB lookup must never
 * be recorded as "nothing available" — that would be a permanent lie baked into
 * the row (the same trap the trailer loader has).
 */

const REGIONS = ["IN", "US"];

const raw = (over: Record<string, unknown> = {}) => ({
  IN: {
    link: "https://www.themoviedb.org/movie/1/watch?locale=IN",
    flatrate: [{ provider_id: 8, provider_name: "Amazon Prime Video", logo_path: "/prime.png" }],
    rent: [{ provider_id: 2, provider_name: "Apple TV Store", logo_path: "/apple.png" }],
  },
  US: {
    link: "https://www.themoviedb.org/movie/1/watch?locale=US",
    flatrate: [{ provider_id: 9, provider_name: "ViX", logo_path: "/vix.png" }],
  },
  GB: {
    link: "https://www.themoviedb.org/movie/1/watch?locale=GB",
    flatrate: [{ provider_id: 8, provider_name: "Amazon Prime Video", logo_path: "/prime.png" }],
  },
  ...over,
});

describe("normalizeWatchProviders", () => {
  it("keeps only the regions we serve", () => {
    const out = normalizeWatchProviders(raw() as never, REGIONS);
    expect(out.map((r) => r.code)).toEqual(["IN", "US"]);
    expect(out.map((r) => r.code)).not.toContain("GB");
  });

  it("expands relative logo paths to TMDB CDN URLs", () => {
    const [india] = normalizeWatchProviders(raw() as never, REGIONS);
    expect(india?.flatrate[0]).toEqual({
      id: 8,
      name: "Amazon Prime Video",
      logo: "https://image.tmdb.org/t/p/w92/prime.png",
    });
  });

  it("keeps the JustWatch deep link per region", () => {
    const [india, us] = normalizeWatchProviders(raw() as never, REGIONS);
    expect(india?.link).toContain("locale=IN");
    expect(us?.link).toContain("locale=US");
  });

  it("drops a region with no offers rather than storing an empty shell", () => {
    const out = normalizeWatchProviders(raw({ US: { link: "x", flatrate: [], rent: [], buy: [] } }) as never, REGIONS);
    expect(out.map((r) => r.code)).toEqual(["IN"]);
  });

  it("drops a region TMDB does not list at all", () => {
    const out = normalizeWatchProviders({ IN: raw().IN } as never, ["IN", "US"]);
    expect(out.map((r) => r.code)).toEqual(["IN"]);
  });

  it("tolerates a missing or empty response", () => {
    expect(normalizeWatchProviders(undefined, REGIONS)).toEqual([]);
    expect(normalizeWatchProviders({}, REGIONS)).toEqual([]);
  });

  it("skips malformed provider entries and null logos", () => {
    const out = normalizeWatchProviders(
      { IN: { link: null, flatrate: [{ provider_name: "Ok", logo_path: null }, {}, { provider_name: 42 }] } } as never,
      ["IN"],
    );
    // `{ provider_name: 42 }` is coerced by TMDB's shape, `{}` is dropped.
    expect(out[0]?.flatrate.length).toBeLessThanOrEqual(2);
    expect(out[0]?.flatrate[0]).toMatchObject({ name: "Ok", logo: null });
  });

  it("separates subscription, rental and purchase", () => {
    const [india] = normalizeWatchProviders(raw() as never, REGIONS);
    expect(india?.flatrate.map((p) => p.name)).toEqual(["Amazon Prime Video"]);
    expect(india?.rent.map((p) => p.name)).toEqual(["Apple TV Store"]);
    expect(india?.buy).toEqual([]);
  });
});

describe("GET /flicks/movie/:id/providers", () => {
  const stored = [
    { code: "IN", link: "l-in", flatrate: [{ id: 8, name: "Prime", logo: "u" }], rent: [], buy: [] },
  ];

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

  it("serves stored providers without calling TMDB", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { app } = build({ tmdb_id: 27205, watch_providers: stored, providers_checked: true });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/flicks/movie/1/providers" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.regions).toEqual(stored);
    // TMDB attribution is a licence requirement, not a nicety.
    expect(body.attribution.text).toMatch(/justwatch/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns 404 for an unknown movie", async () => {
    const { app } = build(undefined);
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/flicks/movie/999/providers" });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("rejects a malformed movie id", async () => {
    const { app } = build({ tmdb_id: 1, providers_checked: true, watch_providers: [] });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/flicks/movie/abc/providers" });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 503 and records NOTHING when TMDB fails", async () => {
    // The important one: a failed lookup must not be stored as "no providers",
    // which would be a permanent lie. providers_checked stays false so a later
    // visit retries.
    vi.mocked(getWatchProviders).mockResolvedValue({ ok: false, regions: [] });
    const { app, updates } = build({ tmdb_id: 27205, providers_checked: false, watch_providers: null });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/flicks/movie/1/providers" });
    await app.close();

    expect(res.statusCode).toBe(503);
    expect(updates).toHaveLength(0);
  });

  it("fetches once on first visit and persists the answer", async () => {
    vi.mocked(getWatchProviders).mockResolvedValue({
      ok: true,
      regions: [{ code: "US", link: "l-us", flatrate: [{ id: 9, name: "ViX", logo: "u" }], rent: [], buy: [] }],
    });
    const { app, updates } = build({ tmdb_id: 27205, providers_checked: false, watch_providers: null });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/flicks/movie/1/providers" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().regions[0].code).toBe("US");
    expect(updates).toHaveLength(1);
    // The persisted JSON must mark the row as answered for.
    const [firstUpdate] = updates;
    expect(String(firstUpdate?.[0])).toContain("US");
    expect(String(firstUpdate?.[1])).toBe("1");
  });

  it("persists an empty answer as genuinely 'nothing available'", async () => {
    vi.mocked(getWatchProviders).mockResolvedValue({ ok: true, regions: [] });
    const { app, updates } = build({ tmdb_id: 999, providers_checked: false, watch_providers: null });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/flicks/movie/1/providers" });
    await app.close();

    // ok=true with no regions is a real answer and IS recorded (unlike a failure).
    expect(res.statusCode).toBe(200);
    expect(res.json().regions).toEqual([]);
    expect(updates).toHaveLength(1);
  });

  it("handles a movie with no tmdb id without calling TMDB", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { app } = build({ tmdb_id: null, providers_checked: false, watch_providers: null });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/flicks/movie/1/providers" });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().regions).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
