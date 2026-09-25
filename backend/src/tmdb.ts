/**
 * Minimal TMDB client for the API server (trailers etc.).
 * Uses the TMDB_API_KEY from env. Failures are reported via ok=false so
 * callers can distinguish "no videos exist" (ok=true) from "couldn't reach
 * TMDB" (ok=false) — the latter must not be cached as a permanent miss.
 */

const API_KEY = (): string => process.env.TMDB_API_KEY ?? "";
const BASE = "https://api.themoviedb.org/3";
/** TMDB image CDN; we store provider logos as relative paths and expand them. */
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
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

/** Shared TTL cache for TMDB lookups (trailers, providers). */
const cache = new Map<string, { ts: number; value: unknown }>();

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

/**
 * Rank a TMDB video entry; higher is a better 'main trailer' candidate.
 *
 * Exported for tests: this is the business logic that makes a stored trailer
 * the *right* trailer instead of an ASL version, a Short, or a promo spot.
 */
export function trailerScore(v: RankableVideo): number {
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

/**
 * One TMDB GET with optional retries.
 *
 * `attempts` defaults to 1 so request-time callers keep today's single-shot
 * behaviour (a user waiting on a trailer should not make three round trips).
 * Batch jobs pass more: without retries a single connection reset or a 429 is
 * recorded as "TMDB has nothing for this film", which is wrong and permanent.
 * Backoff is short because these failures are mostly network resets, not
 * throttling.
 */
async function tmdbGet<T>(path: string, params: Record<string, string>, attempts = 1): Promise<T | null> {
  const key = API_KEY();
  if (!key) return null;
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) return (await res.json()) as T;
      // A 404 means the film is gone; anything else (429, 5xx) is worth another go.
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      /* network error — fall through to the retry */
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  return null;
}

/**
 * TMDB keyword names for a film, comma-joined.
 *
 * These matter because TMDB's overview is a spoiler-free marketing blurb: The
 * Sixth Sense never mentions that the boy sees dead people, and Titanic never
 * says "iceberg". Keywords carry that vocabulary, and they are what the plot
 * vector is missing for whole classes of query.
 *
 * Returns { ok, keywords }: ok=false means TMDB was unreachable, so callers must
 * not record the film as checked (same contract as trailers and providers).
 */
export async function getKeywords(
  tmdbId: number,
  attempts = 1,
): Promise<{ ok: boolean; keywords: string[] }> {
  const data = await tmdbGet<{ keywords?: { id?: number; name?: string }[] }>(
    `/movie/${tmdbId}/keywords`,
    {},
    attempts,
  );
  if (data === null) return { ok: false, keywords: [] };
  const names = (data.keywords ?? [])
    .map((k) => String(k.name ?? "").trim())
    .filter(Boolean);
  return { ok: true, keywords: names };
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
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value as TrailerLookup;

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

// ---------------------------------------------------------------- providers

/** Regions we store. TMDB returns ~112 in one response; we keep the ones we serve. */
export function configuredRegions(): string[] {
  return (process.env.WATCH_REGIONS ?? "IN,US")
    .split(",")
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);
}

export interface WatchProvider {
  id: number | null;
  name: string;
  logo: string | null;
}
export interface RegionProviders {
  code: string;
  link: string | null;
  flatrate: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
}
export interface ProvidersLookup {
  ok: boolean; // true = TMDB answered (regions may be empty)
  regions: RegionProviders[];
}

/** Raw TMDB shape (only the fields we use). */
interface RawProvider {
  provider_id?: number;
  provider_name?: string;
  logo_path?: string | null;
}
interface RawRegion {
  link?: string;
  flatrate?: RawProvider[];
  rent?: RawProvider[];
  buy?: RawProvider[];
}

/**
 * Reduce a `/watch/providers` response to the regions we serve.
 *
 * One request returns every region, so this selects rather than filters by
 * need: adding a region later needs no re-fetch of the catalogue, only a change
 * to WATCH_REGIONS and a refresh.
 *
 * Logo paths are TMDB CDN relative; they are expanded here so the frontend does
 * not have to know TMDB's image base.
 */
export function normalizeWatchProviders(
  results: Record<string, RawRegion> | null | undefined,
  regions: string[] = configuredRegions(),
): RegionProviders[] {
  const out: RegionProviders[] = [];
  for (const code of regions) {
    const raw = results?.[code];
    if (!raw) continue;
    const bucket = (list?: RawProvider[]): WatchProvider[] =>
      (list ?? [])
        .filter((p) => p && typeof p.provider_name === "string")
        .map((p) => ({
          id: typeof p.provider_id === "number" ? p.provider_id : null,
          name: String(p.provider_name),
          logo: p.logo_path ? `${TMDB_IMAGE_BASE}/w92${p.logo_path}` : null,
        }));
    const flatrate = bucket(raw.flatrate);
    const rent = bucket(raw.rent);
    const buy = bucket(raw.buy);
    // A region with no offers at all is not worth storing.
    if (!flatrate.length && !rent.length && !buy.length) continue;
    out.push({ code, link: raw.link ?? null, flatrate, rent, buy });
  }
  return out;
}

/**
 * Watch providers for a TMDB movie id.
 *
 * `ok: false` means TMDB was unreachable and the caller must NOT record the
 * result as "nothing available" — same contract as getMovieVideos.
 */
export async function getWatchProviders(tmdbId: number): Promise<ProvidersLookup> {
  const cacheKey = `providers:${tmdbId}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value as ProvidersLookup;

  const data = await tmdbGet<{ results?: Record<string, RawRegion> }>(`/movie/${tmdbId}/watch/providers`, {});
  if (data === null) return { ok: false, regions: [] };

  const value: ProvidersLookup = { ok: true, regions: normalizeWatchProviders(data.results) };
  cache.set(cacheKey, { ts: Date.now(), value });
  return value;
}
