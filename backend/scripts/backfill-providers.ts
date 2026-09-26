/**
 * Backfill `movies.watch_providers` from TMDB.
 *
 * One request per film (`/movie/{id}/watch/providers`), and that single response
 * carries every region — so serving India and the US costs no more than serving
 * one. There is no bulk endpoint and `/discover` has no provider data, which is
 * why this is per-film work while the language backfill was not.
 *
 * Starts with the highest-rated films, which is the order the app itself
 * browses, so a partial backfill covers what visitors actually open first. The
 * ordering uses the same vote-weighted rating the app ranks by, so the sample
 * lands on films people recognise rather than on high-rated obscurities.
 *
 * No checkpoint file: the row IS the checkpoint. `providers_checked` marks a
 * film TMDB has answered for, so the job is resumable, re-runnable and safe to
 * interrupt by definition.
 *
 * Usage:
 *   npm run backfill:providers                 # 1000 films (default sample)
 *   npm run backfill:providers -- --limit 5000
 *   npm run backfill:providers -- --all        # whole catalogue (~31k requests)
 *   DATABASE_URL=<supabase> npm run backfill:providers
 */

import { getPool, closePool } from "../src/db/pool.js";
import { logger } from "../src/logger.js";
import { configuredRegions, getWatchProviders } from "../src/tmdb.js";
import type { RegionProviders } from "../src/tmdb.js";
import { WEIGHTED_RATING_SQL } from "../src/services/rating.js";

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const limitArg = args.indexOf("--limit");
const LIMIT = ALL
  ? Number.POSITIVE_INFINITY
  : limitArg !== -1
    ? Number(args[limitArg + 1])
    : Number(process.env.PROVIDER_BACKFILL_LIMIT ?? 1000);
const BATCH = 200;
/**
 * Films fetched at once. Sequential fetching with a 150ms courtesy pause ran at
 * ~2 films/s, which is hours for the catalogue; TMDB tolerates far more, and the
 * measured keyword backfill sustained 23/s on the same client.
 */
const CONCURRENCY = Number(process.env.PROVIDER_CONCURRENCY ?? 8);
/** Optional pause between batches, for rate-limit paranoia. */
const DELAY_MS = Number(process.env.TMDB_REQUEST_DELAY_MS ?? 0);
/** Abort if TMDB seems down rather than grinding through the whole queue. */
const MAX_CONSECUTIVE_FAILURES = 10;

if (!Number.isFinite(LIMIT) && !ALL) {
  logger.error({ limit: args[limitArg + 1] }, "invalid --limit");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const pool = getPool();
  const regions = configuredRegions();

  const { rows: pendingRows } = await pool.query(
    "SELECT count(*)::int AS n FROM movies WHERE providers_checked = false AND tmdb_id IS NOT NULL",
  );
  logger.info(
    { regions, target: ALL ? "all" : LIMIT, pending: pendingRows[0]?.n },
    "watch provider backfill starting",
  );

  let checked = 0;
  let withOffers = 0;
  let withoutOffers = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let stop = false;

  while (!stop && checked < LIMIT) {
    const remaining = ALL ? BATCH : Math.min(BATCH, LIMIT - checked);
    const { rows } = await pool.query(
      // Vote-weighted, matching how the app itself ranks, so a partial run has
      // covered the films people actually open. `id` breaks ties so batches
      // cannot repeat or skip rows.
      `SELECT id, tmdb_id FROM movies
        WHERE providers_checked = false AND tmdb_id IS NOT NULL
        ORDER BY ${WEIGHTED_RATING_SQL} DESC NULLS LAST, id ASC
        LIMIT $1`,
      [remaining],
    );
    if (rows.length === 0) break;

    // Fetched concurrently, then written in one statement. Both halves matter:
    // sequentially this ran at ~2 films/s, and a per-film UPDATE against the
    // pooler is a round trip each (the same lesson as the embedding backfill and
    // the keyword backfill).
    const queue = [...rows];
    const fetched: { id: number; found: RegionProviders[] }[] = [];
    const worker = async (): Promise<void> => {
      for (;;) {
        if (stop) return;
        const row = queue.shift();
        if (!row) return;
        const { ok, regions: found } = await getWatchProviders(Number(row.tmdb_id), 4);
        if (!ok) {
          // Leave providers_checked = false so this film is retried later. A
          // failed lookup must never be recorded as "nothing available".
          failed += 1;
          consecutiveFailures += 1;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            logger.error(
              { consecutiveFailures, checked },
              "TMDB is failing repeatedly; stopping so the remainder is retried later",
            );
            stop = true;
            return;
          }
          continue;
        }
        consecutiveFailures = 0;
        fetched.push({ id: Number(row.id), found });
        checked += 1;
        if (found.length) withOffers += 1;
        else withoutOffers += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));

    if (fetched.length) {
      await pool.query(
        `UPDATE movies m
            SET watch_providers = d.wp::jsonb,
                providers_checked = true,
                providers_updated_at = now()
           FROM (SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS wp) d
          WHERE m.id = d.id`,
        [fetched.map((f) => f.id), fetched.map((f) => JSON.stringify(f.found))],
      );
    }
    logger.info({ checked, withOffers, withoutOffers, failed }, "progress");
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  const { rows: remainingRows } = await pool.query(
    "SELECT count(*)::int AS n FROM movies WHERE providers_checked = false AND tmdb_id IS NOT NULL",
  );
  const stillPending = remainingRows[0]?.n ?? 0;

  logger.info(
    {
      regions,
      checked,
      withOffers,
      withoutOffers,
      failed,
      stillPending,
      elapsedNote: failed ? "failed films stay unchecked and will be retried on the next run" : undefined,
    },
    "watch provider backfill summary",
  );

  await closePool();
}

main().catch(async (err) => {
  logger.error({ err }, "watch provider backfill failed");
  await closePool().catch(() => {});
  process.exit(1);
});
