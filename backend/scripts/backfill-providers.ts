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
/** Polite pause between TMDB calls (the client also backs off on failures). */
const DELAY_MS = Number(process.env.TMDB_REQUEST_DELAY_MS ?? 150);
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
      // Highest-rated first: the app browses by rating, so this is the order in
      // which films are actually opened. `id` breaks ties so batches cannot
      // repeat or skip rows.
      // Vote-weighted, matching how the app itself ranks: the raw rating would
      // spend the first batches on 9.9-rated films with three-figure vote counts.
      `SELECT id, tmdb_id FROM movies
        WHERE providers_checked = false AND tmdb_id IS NOT NULL
        ORDER BY ${WEIGHTED_RATING_SQL} DESC NULLS LAST, id ASC
        LIMIT $1`,
      [remaining],
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const movieId = Number(row.id);
      const tmdbId = Number(row.tmdb_id);
      const { ok, regions: found } = await getWatchProviders(tmdbId);

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
          break;
        }
        continue;
      }
      consecutiveFailures = 0;

      await pool.query(
        "UPDATE movies SET watch_providers = $1, providers_checked = true, providers_updated_at = now() WHERE id = $2",
        [JSON.stringify(found), movieId],
      );
      checked += 1;
      if (found.length) withOffers += 1;
      else withoutOffers += 1;
      if (checked % 100 === 0) logger.info({ checked, withOffers, withoutOffers, failed }, "progress");

      await sleep(DELAY_MS);
    }
  }

  const pendingRes = await pool.query(
    "SELECT count(*)::int AS n FROM movies WHERE providers_checked = false AND tmdb_id IS NOT NULL",
  );
  const stillPending = Number((pendingRes.rows[0] as { n?: number } | undefined)?.n ?? 0);

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
