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

// Trailer selection quality filters (see getMovieVideos).
// Hard skip: accessibility/localisation variants that are not the main trailer.
const HARD_SKIP_RE = /sign language|\basl\b/i;
// Soft penalty: marketing noise that should never outrank a real trailer.
const BAD_NAME_RE = new RegExp(
  "\\bshorts?\\b|vertical|#short|first look|comic[- ]con|sneak peek|announcement" +
    "|exclusive|now playing|streaming|\\bspecial\\b|prologue|cinemas now|see it again" +
    "|tickets|on sale|book now|buy tickets|own it|livestream|featurette|behind the scenes" +
    "|interview|\\bspot\\b|reaction|review|\\bclip\\b|memories|\\btalk\\b|day one|production" +
    "|reveal|\\bbonus\\b",
  "i",
);

interface RankableVideo extends TmdbVideo {
  official?: boolean;
  size?: number;
  iso_639_1?: string;
  iso_3166_1?: string;
  published_at?: string;
}

/** Rank a TMDB video entry; higher is a better 'main trailer' candidate. */
function trailerScore(v: RankableVideo): number {
  const name = v.name ?? "";
  let score = 0;
  if (v.type === "Trailer") score += 100;
  else if (v.type === "Teaser") score += 30;
  if (v.official === true) score += 60;
  if (/official trailer/i.test(name)) score += 40;
  if (/\btrailer\b/i.test(name)) score += 25;
  if (/\bmain trailer\b|\bfinal trailer\b/i.test(name)) score += 30;
  // A teaser is a teaser even when TMDB types it 'Trailer'.
  if (/teaser/i.test(name)) score -= 35;
  if (v.iso_639_1 === "en") score += 30;
  if (v.iso_3166_1 === "US") score += 20;
  const size = v.size ?? 0;
  score += size >= 2000 ? 25 : size >= 1000 ? 18 : size >= 700 ? 8 : 0;
  if (BAD_NAME_RE.test(name)) score -= 60;
  return score;
}

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
 * Fetch YouTube trailer/teaser keys for a TMDB movie id, best-first.
 *
 * TMDB's /videos list mixes official trailers with teasers, featurettes,
 * regional marketing spots, sign-language versions and Shorts — so we score
 * candidates: Trailer type, official flag, "official trailer" name, English/US
 * locale, higher resolution; hard-skip sign-language versions, penalise Shorts
 * and "in cinemas now" style spots. Ties break by earliest published_at.
 *
 * Returns { ok, videos }: ok=true means TMDB answered (videos may be empty =
 * genuinely no trailer); ok=false means TMDB was unreachable — callers
 * should NOT cache that as a permanent miss.
 */
export async function getMovieVideos(tmdbId: number): Promise<TrailerLookup> {
  const cacheKey = String(tmdbId);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;

  const data = await tmdbGet<{ results?: (TmdbVideo & { official?: boolean; size?: number; iso_639_1?: string; iso_3166_1?: string; published_at?: string })[] }>(
    `/movie/${tmdbId}/videos`,
    {},
  );
  if (data === null) {
    return { ok: false, videos: [] };
  }
  const videos = (data.results ?? [])
    .filter(
      (v) =>
        v.site === "YouTube" &&
        v.key &&
        (v.type === "Trailer" || v.type === "Teaser") &&
        !HARD_SKIP_RE.test(v.name ?? ""),
    )
    .sort((a, b) => {
      const byScore = trailerScore(b) - trailerScore(a);
      if (byScore !== 0) return byScore;
      // Equal scores: prefer the LATEST upload (main/final trailers land after
      // teasers and Comic-Con first looks).
      return (b.published_at ?? "").localeCompare(a.published_at ?? "");
    });
  const result: TrailerLookup = { ok: true, videos };
  cache.set(cacheKey, { ts: Date.now(), value: result });
  return result;
}

/** Clean up cache (mainly for tests). */
export function clearTmdbCache(): void {
  cache.clear();
}
