/**
 * Fetch movies (1980 → current, vote_count >= 50) from TMDB and upsert
 * them into the `movies` table. Metadata comes from /discover/movie
 * (paged, release-date ranges), directors + cast from /movie/{id}/credits.
 *
 *   - Resume-safe: progress is checkpointed to .data/tmdb-progress.json
 *     (year + page) after every page; interrupted runs continue where
 *     they left off. Upserts are idempotent.
 *   - TMDB caps pagination at 500 pages (10k results) per query, so any
 *     range that fills 500 pages is split in half and re-fetched
 *     recursively — no silent truncation.
 *   - 429/5xx responses retry with exponential backoff.
 *
 * Usage:
 *   TMDB_API_KEY=... npm run fetch:movies
 *   TMDB_API_KEY=... START_YEAR=2023 END_YEAR=2023 npm run fetch:movies   # single year
 *   TMDB_API_KEY=... TMDB_PAGE_CAP=2 npm run fetch:movies                 # smoke test
 */

import fs from "node:fs";
import path from "node:path";
import { getPool, closePool } from "../src/db/pool.js";
import { logger } from "../src/logger.js";

const API_KEY: string = (() => {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    logger.error("TMDB_API_KEY is required (add to .env or export it)");
    process.exit(1);
  }
  return key;
})();
const START_YEAR = Number(process.env.START_YEAR ?? 1980);
const END_YEAR = Number(process.env.END_YEAR ?? new Date().getFullYear());
const MIN_VOTE_COUNT = Number(process.env.MIN_VOTE_COUNT ?? 50);
const PAGE_CAP = Number(process.env.TMDB_PAGE_CAP ?? 0); // 0 = unlimited
const CONCURRENCY = Number(process.env.TMDB_CONCURRENCY ?? 6);
const PROGRESS_FILE = path.resolve(process.cwd(), ".data", "tmdb-progress.json");

const BASE = "https://api.themoviedb.org/3";
const LANGUAGE = "en-US";
// TMDB hard cap: 500 pages / 10k results per query.
const MAX_PAGES = 500;

if (!API_KEY) {
  logger.error("TMDB_API_KEY is required (add to .env or export it)");
  process.exit(1);
}

interface TmdbMovie {
  id: number;
  title?: string;
  overview?: string | null;
  release_date?: string | null;
  vote_average?: number;
  vote_count?: number;
  runtime?: number | null;
  genre_ids?: number[];
  poster_path?: string | null;
  revenue?: number | null;
  adult?: boolean;
}

interface DiscoverResponse {
  page: number;
  total_pages: number;
  results: TmdbMovie[];
}

interface Credit {
  job?: string;
  name?: string;
  order?: number;
}

interface CreditsResponse {
  crew?: Credit[];
  cast?: Credit[];
}

let genreNames = new Map<number, string>();
let poolReady: Promise<void> | undefined;

async function tmdbJson<T>(urlPath: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(`${BASE}${urlPath}`);
  url.searchParams.set("api_key", API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let attempt = 0;
  for (;;) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 || res.status >= 500) {
      attempt += 1;
      const delay = Math.min(1000 * 2 ** attempt, 30_000);
      logger.warn({ status: res.status, attempt, delayMs: delay }, "TMDB rate-limit/error; backing off");
      await new Promise((r) => setTimeout(r, delay));
      if (attempt > 8) throw new Error(`TMDB request failed after retries: ${res.status}`);
      continue;
    }
    throw new Error(`TMDB request failed: ${res.status} ${res.statusText} (${urlPath})`);
  }
}

function loadProgress(): { completedYears: number[]; pages: Record<string, number> } {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
  } catch {
    return { completedYears: [], pages: {} };
  }
}

function saveProgress(progress: { completedYears: number[]; pages: Record<string, number> }): void {
  fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  fs.writeFileSync(PROGRESS_FILE + ".bak", JSON.stringify(progress, null, 2));
}

async function ensurePool(): Promise<void> {
  if (!poolReady) {
    poolReady = (async () => {
      const pool = getPool();
      await pool.query("SELECT 1");
      const genres = await tmdbJson<{ genres: { id: number; name: string }[] }>("/genre/movie/list", { language: LANGUAGE });
      genreNames = new Map(genres.genres.map((g) => [g.id, g.name]));
    })();
  }
  await poolReady;
}

const OVERVIEW_COLUMNS = `tmdb_id, movie_name, rating, runtime, genre, plot, votes, gross, poster_url`;
const UPSERT_SQL = `
  INSERT INTO movies (${OVERVIEW_COLUMNS}, metascore)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
  ON CONFLICT (tmdb_id) DO UPDATE SET
    movie_name = EXCLUDED.movie_name,
    rating = EXCLUDED.rating,
    runtime = EXCLUDED.runtime,
    genre = EXCLUDED.genre,
    plot = EXCLUDED.plot,
    votes = EXCLUDED.votes,
    gross = EXCLUDED.gross,
    poster_url = EXCLUDED.poster_url`;

async function upsertMovie(movie: TmdbMovie): Promise<boolean> {
  const overview = movie.overview?.trim();
  if (!overview) return false; // no plot → no embeddings; skip
  const poster = movie.poster_path
    ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
    : null;
  const genre = (movie.genre_ids ?? [])
    .map((id) => genreNames.get(id))
    .filter(Boolean)
    .join(", ");
  const pool = getPool();
  await pool.query(UPSERT_SQL, [
    movie.id,
    movie.title ?? `Movie ${movie.id}`,
    movie.vote_average ?? null,
    movie.runtime ?? null,
    genre || null,
    overview,
    movie.vote_count != null ? String(movie.vote_count) : null,
    movie.revenue && movie.revenue > 0 ? String(movie.revenue) : null,
    poster,
  ]);
  return true;
}

async function fetchCredits(movieId: number): Promise<{ directors: string | null; stars: string | null }> {
  const data = await tmdbJson<CreditsResponse>(`/movie/${movieId}/credits`, { language: LANGUAGE });
  const directors = (data.crew ?? [])
    .filter((c) => c.job === "Director" && c.name)
    .map((c) => c.name)
    .slice(0, 4)
    .join(", ");
  const stars = (data.cast ?? [])
    .filter((c) => c.name)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .map((c) => c.name)
    .slice(0, 10)
    .join(", ");
  return { directors: directors || null, stars: stars || null };
}

async function updateCredits(tmdbId: number, directors: string | null, stars: string | null): Promise<void> {
  const pool = getPool();
  await pool.query("UPDATE movies SET directors = $2, stars = $3 WHERE tmdb_id = $1", [tmdbId, directors, stars]);
}

/** Concurrency-limited map over fetch tasks. */
async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Fetch one release-date range; splits in half when TMDB's 500-page cap is hit. */
async function fetchRange(gte: string, lte: string, progress: { completedYears: number[]; pages: Record<string, number> }): Promise<{ kept: number; skipped: number }> {
  let page = (progress.pages[gte] ?? 0) + 1;
  let kept = 0;
  let skipped = 0;

  // First page tells us if this range is small enough to page through directly.
  const first = await tmdbJson<DiscoverResponse>("/discover/movie", {
    "primary_release_date.gte": gte,
    "primary_release_date.lte": lte,
    "vote_count.gte": MIN_VOTE_COUNT,
    "sort_by": "primary_release_date.asc",
    "include_adult": "false",
    language: LANGUAGE,
    page: 1,
  });

  if (first.total_pages >= MAX_PAGES || (PAGE_CAP > 0 && first.total_pages > PAGE_CAP)) {
    // Too many results: split the range in half and recurse.
    const mid = new Date((new Date(gte).getTime() + new Date(lte).getTime()) / 2)
      .toISOString()
      .slice(0, 10);
    if (mid === gte || mid === lte) throw new Error(`Range splitting stuck at ${gte}..${lte}`);
    logger.info({ gte, lte }, "Range too large — splitting");
    const left = await fetchRange(gte, mid, progress);
    const right = await fetchRange(mid.slice(0, 8) + "-01", lte, progress);
    return { kept: left.kept + right.kept, skipped: left.skipped + right.skipped };
  }

  const totalPages = PAGE_CAP > 0 ? Math.min(PAGE_CAP, first.total_pages) : first.total_pages;
  let pageResult = first;
  if (page > 1) {
    pageResult = await tmdbJson<DiscoverResponse>("/discover/movie", {
      "primary_release_date.gte": gte,
      "primary_release_date.lte": lte,
      "vote_count.gte": MIN_VOTE_COUNT,
      "sort_by": "primary_release_date.asc",
      "include_adult": "false",
      language: LANGUAGE,
      page,
    });
  }

  while (page <= totalPages) {
    const movies = page === 1 ? pageResult.results : (
      await tmdbJson<DiscoverResponse>("/discover/movie", {
        "primary_release_date.gte": gte,
        "primary_release_date.lte": lte,
        "vote_count.gte": MIN_VOTE_COUNT,
        "sort_by": "primary_release_date.asc",
        "include_adult": "false",
        language: LANGUAGE,
        page,
      })
    ).results;

    // Upsert discover fields (skip movies without an overview).
    const keptIds: number[] = [];
    for (const movie of movies) {
      if (await upsertMovie(movie)) {
        keptIds.push(movie.id);
        kept += 1;
      } else {
        skipped += 1;
      }
    }

    // Enrich with directors + cast, concurrently.
    const credits = await mapConcurrent(keptIds, CONCURRENCY, async (id) => {
      try {
        return { id, ...(await fetchCredits(id)) };
      } catch (err) {
        logger.warn({ id, err: err instanceof Error ? err.message : String(err) }, "credits fetch failed");
        return { id, directors: null, stars: null };
      }
    });
    for (const c of credits) {
      await updateCredits(c.id, c.directors, c.stars);
    }

    progress.pages[gte] = page;
    saveProgress(progress);
    if (page % 25 === 0 || page === totalPages) {
      logger.info({ gte, lte, page, totalPages, kept, skipped }, "range progress");
    }
    page += 1;
    if (PAGE_CAP > 0 && page > PAGE_CAP) break;
  }

  delete progress.pages[gte];
  return { kept, skipped };
}

/** Ctrl+C safety: flush progress via the .bak file (already written per page). */
process.on("SIGINT", () => {
  logger.warn("Interrupted — progress checkpoint saved in .data/tmdb-progress.json(.bak)");
  process.exit(130);
});

async function main(): Promise<void> {
  await ensurePool();
  const progress = loadProgress();
  const startedAt = Date.now();
  let totalKept = 0;
  let totalSkipped = 0;
  let totalYears = 0;

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    if (progress.completedYears.includes(year)) {
      logger.info({ year }, "already complete — skipping");
      continue;
    }
    const gte = `${year}-01-01`;
    const lte = `${year}-12-31`;
    logger.info({ year }, "Fetching");
    try {
      const { kept, skipped } = await fetchRange(gte, lte, progress);
      totalKept += kept;
      totalSkipped += skipped;
      totalYears += 1;
      progress.completedYears.push(year);
      saveProgress(progress);
      logger.info({ year, kept, skipped }, "year done");
    } catch (err) {
      logger.error({ year, err: err instanceof Error ? err.message : String(err) }, "year failed — will resume next run");
      break;
    }
  }

  const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);
  logger.info({ totalKept, totalSkipped, totalYears, minutes }, "Fetch complete");
  await closePool();
}

await main();