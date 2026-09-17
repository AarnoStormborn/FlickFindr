/**
 * Backfill `movies.original_language` from TMDB.
 *
 * Why a sweep and not 30k per-movie lookups: TMDB has no bulk-by-id endpoint
 * (`/movie/summaries` 404s on a v3 key), but `/discover/movie` returns 20
 * movies per request and each one already carries `original_language`. Paged by
 * release year — the same segmentation the original ingest used, which also
 * keeps every query under TMDB's 500-page cap — the whole catalogue costs
 * ~1.5-2k requests instead of ~31k.
 *
 * The sweep only reaches movies TMDB still lists under those filters, so
 * rows it misses are reported and (optionally) filled one-by-one afterwards.
 *
 * Resumable: completed years are checkpointed, so an interrupted run continues
 * where it stopped. Re-running is safe (idempotent UPDATE by tmdb_id).
 *
 * Usage:
 *   npm run backfill:languages              # sweep, then report leftovers
 *   npm run backfill:languages -- --fill    # also fetch leftovers per movie
 *   DATABASE_URL=<supabase> npm run backfill:languages   # target production
 */

import fs from "node:fs";
import path from "node:path";
import { getPool, closePool } from "../src/db/pool.js";
import { logger } from "../src/logger.js";

const API_KEY = process.env.TMDB_API_KEY ?? "";
const BASE = "https://api.themoviedb.org/3";
const LANGUAGE = "en-US";
/** TMDB hard cap on discover pagination. */
const MAX_PAGES = 500;
/** Polite pause between requests (~5/s, well inside TMDB's limits). */
const REQUEST_DELAY_MS = Number(process.env.TMDB_REQUEST_DELAY_MS ?? 200);
const MIN_VOTE_COUNT = process.env.MIN_VOTE_COUNT ?? "50";
const START_YEAR = Number(process.env.START_YEAR ?? 1980);
const END_YEAR = Number(process.env.END_YEAR ?? new Date().getFullYear());
const PROGRESS_FILE = path.resolve(process.cwd(), ".data", "language-progress.json");
const FILL_REMAINDER = process.argv.includes("--fill");

if (!API_KEY) {
  logger.error("TMDB_API_KEY is required (add to .env or export it)");
  process.exit(1);
}

interface DiscoverResult {
  id: number;
  original_language?: string | null;
}
interface DiscoverResponse {
  page: number;
  total_pages: number;
  results: DiscoverResult[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a TMDB JSON document, backing off on transient/network failures. */
async function tmdbJson<T>(urlPath: string, params: Record<string, string | number>): Promise<T | null> {
  const url = new URL(`${BASE}${urlPath}`);
  url.searchParams.set("api_key", API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      attempt += 1;
      if (attempt > 6) {
        logger.warn({ err: err instanceof Error ? err.message : String(err), urlPath }, "TMDB request gave up");
        return null;
      }
      const delay = Math.min(1000 * 2 ** attempt, 30_000);
      logger.warn({ attempt, delayMs: delay }, "TMDB network error; backing off");
      await sleep(delay);
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 || res.status >= 500) {
      attempt += 1;
      if (attempt > 6) return null;
      const delay = Math.min(1000 * 2 ** attempt, 30_000);
      logger.warn({ status: res.status, attempt, delayMs: delay }, "TMDB rate-limit/error; backing off");
      await sleep(delay);
      continue;
    }
    // 401/404 etc. will not fix themselves.
    logger.error({ status: res.status, urlPath }, "TMDB request failed permanently");
    return null;
  }
}

interface Progress {
  completedYears: number[];
}
function loadProgress(): Progress {
  try {
    const p = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    return { completedYears: Array.isArray(p.completedYears) ? p.completedYears : [] };
  } catch {
    return { completedYears: [] };
  }
}
function saveProgress(p: Progress): void {
  try {
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p));
  } catch (err) {
    logger.warn({ err }, "could not write progress file");
  }
}

/** Apply tmdb_id -> language as batched UPDATEs. */
async function applyUpdates(pool: ReturnType<typeof getPool>, pairs: Array<[number, string]>): Promise<number> {
  const CHUNK = 1000;
  let written = 0;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    const ids = chunk.map(([id]) => id);
    const langs = chunk.map(([, lang]) => lang);
    const res = await pool.query(
      `UPDATE movies AS m
          SET original_language = v.lang
         FROM (SELECT unnest($1::int[]) AS tmdb_id, unnest($2::text[]) AS lang) AS v
        WHERE m.tmdb_id = v.tmdb_id`,
      [ids, langs],
    );
    written += res.rowCount ?? 0;
  }
  return written;
}

async function main(): Promise<void> {
  const pool = getPool();
  const progress = loadProgress();
  const done = new Set(progress.completedYears);
  const years: number[] = [];
  for (let y = START_YEAR; y <= END_YEAR; y += 1) years.push(y);

  const { rows: pending } = await pool.query(
    "SELECT count(*)::int AS n FROM movies WHERE original_language IS NULL AND tmdb_id IS NOT NULL",
  );
  logger.info({ missing: pending[0]?.n, years: years.length, resumedFrom: done.size, fill: FILL_REMAINDER }, "language backfill starting");

  let totalWritten = 0;
  for (const year of years) {
    if (done.has(year)) continue;

    const found = new Map<number, string>();
    let pages = 0;
    let capped = false;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await tmdbJson<DiscoverResponse>("/discover/movie", {
        language: LANGUAGE,
        "primary_release_year": year,
        "vote_count.gte": MIN_VOTE_COUNT,
        sort_by: "popularity.desc",
        page,
      });
      if (!data) {
        logger.warn({ year, page }, "discover failed; will not mark year complete");
        capped = false;
        pages = page - 1;
        break;
      }
      for (const r of data.results ?? []) {
        if (typeof r.id === "number" && typeof r.original_language === "string" && r.original_language) {
          found.set(r.id, r.original_language);
        }
      }
      pages += 1;
      if (page >= (data.total_pages ?? 1)) break;
      if (page === MAX_PAGES && (data.total_pages ?? 0) >= MAX_PAGES) capped = true;
      await sleep(REQUEST_DELAY_MS);
    }

    const pairs = [...found.entries()];
    const written = await applyUpdates(pool, pairs);
    totalWritten += written;
    if (!capped) {
      done.add(year);
      progress.completedYears = [...done];
      saveProgress(progress);
    }
    logger.info(
      { year, pages, tmdbResults: found.size, rowsUpdated: written, truncatedAtPageCap: capped },
      "year backfilled",
    );
  }

  // ---- Remainder: rows the sweep could not reach ----
  const { rows: leftRows } = await pool.query(
    "SELECT tmdb_id FROM movies WHERE original_language IS NULL AND tmdb_id IS NOT NULL",
  );
  const left = leftRows.map((r) => Number(r.tmdb_id)).filter((n) => Number.isFinite(n));
  logger.info({ totalWritten, stillMissing: left.length }, "sweep complete");

  if (left.length && FILL_REMAINDER) {
    logger.info({ remaining: left.length }, "filling remainder per movie (one request each)");
    const pairs: Array<[number, string]> = [];
    for (const tmdbId of left) {
      const detail = await tmdbJson<{ original_language?: string | null }>(`/movie/${tmdbId}`, { language: LANGUAGE });
      const lang = detail?.original_language;
      if (typeof lang === "string" && lang) pairs.push([tmdbId, lang]);
      await sleep(REQUEST_DELAY_MS);
      if (pairs.length >= 1000) {
        totalWritten += await applyUpdates(pool, pairs);
        logger.info({ batchWritten: pairs.length }, "remainder batch applied");
        pairs.length = 0;
      }
    }
    if (pairs.length) totalWritten += await applyUpdates(pool, pairs);
  }

  const { rows: stats } = await pool.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE original_language IS NOT NULL)::int AS with_language,
           count(DISTINCT original_language)::int AS distinct_languages
      FROM movies
  `);
  const { rows: top } = await pool.query(`
    SELECT original_language, count(*)::int AS n
      FROM movies WHERE original_language IS NOT NULL
     GROUP BY 1 ORDER BY n DESC LIMIT 12
  `);
  const s = stats[0] ?? { total: 0, with_language: 0, distinct_languages: 0 };
  logger.info(
    {
      ...s,
      coverage_pct: s.total ? Number(((100 * s.with_language) / s.total).toFixed(1)) : 0,
      totalWritten,
      top_languages: top.map((r) => `${r.original_language}:${r.n}`),
    },
    "language backfill summary",
  );

  await closePool();
}

main().catch(async (err) => {
  logger.error({ err }, "language backfill failed");
  await closePool().catch(() => {});
  process.exit(1);
});
