/**
 * Minimal TMDB client for the API server (trailers etc.).
 * Uses the TMDB_API_KEY from env. Failures are reported via ok=false so
 * callers can distinguish "no videos exist" (ok=true) from "couldn't reach
 * TMDB" (ok=false) — the latter must not be cached as a permanent miss.
 */

const API_KEY = (): string => process.env.TMDB_API_KEY ?? "";
const BASE = "https://api.themoviedb.org/3";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — videos rarely change

export interface TmdbVideo {
  key: string;
  name: string;
  type: string;
  site: string;
}

export interface TrailerLookup {
  ok: boolean; // true = TMDB responded (videos may still be empty)
  videos: TmdbVideo[];
}

const cache = new Map<string, { ts: number; value: TrailerLookup }>();

async function tmdbGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = API_KEY();
  if (!key) return null;
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // network error
  }
}

/**
 * Fetch YouTube trailer/teaser keys for a TMDB movie id.
 * Returns { ok, videos }: ok=true means TMDB answered (videos may be empty =
 * genuinely no trailer); ok=false means TMDB was unreachable — callers
 * should NOT cache that as a permanent miss.
 */
export async function getMovieVideos(tmdbId: number): Promise<TrailerLookup> {
  const cacheKey = String(tmdbId);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;

  const data = await tmdbGet<{ results?: TmdbVideo[] }>(`/movie/${tmdbId}/videos`, {});
  if (data === null) {
    return { ok: false, videos: [] };
  }
  const videos = (data.results ?? []).filter(
    (v) => v.site === "YouTube" && v.key && (v.type === "Trailer" || v.type === "Teaser"),
  );
  const result: TrailerLookup = { ok: true, videos };
  cache.set(cacheKey, { ts: Date.now(), value: result });
  return result;
}

/** Clean up cache (mainly for tests). */
export function clearTmdbCache(): void {
  cache.clear();
}
