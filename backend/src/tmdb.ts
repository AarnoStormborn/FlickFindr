/**
 * Minimal TMDB client for the API server (trailers etc.).
 * Uses the TMDB_API_KEY from env. All calls fail soft (empty results) so a
 * missing key or network error never breaks the movie pages.
 */

const API_KEY = process.env.TMDB_API_KEY ?? "";
const BASE = "https://api.themoviedb.org/3";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — videos rarely change

export interface TmdbVideo {
  key: string;
  name: string;
  type: string;
  site: string;
}

const cache = new Map<string, { ts: number; value: TmdbVideo[] }>();

async function tmdbGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  if (!API_KEY) return null;
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // network error — fail soft
  }
}

/** YouTube trailer/teaser keys for a TMDB movie id. Empty if none/unavailable. */
export async function getMovieVideos(tmdbId: number): Promise<TmdbVideo[]> {
  const cacheKey = String(tmdbId);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;

  const data = await tmdbGet<{ results?: TmdbVideo[] }>(`/movie/${tmdbId}/videos`, {});
  const videos = (data?.results ?? []).filter(
    (v) => v.site === "YouTube" && v.key && (v.type === "Trailer" || v.type === "Teaser"),
  );
  cache.set(cacheKey, { ts: Date.now(), value: videos });
  return videos;
}

/** Clean up cache (mainly for tests). */
export function clearTmdbCache(): void {
  cache.clear();
}
