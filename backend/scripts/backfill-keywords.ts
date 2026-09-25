/**
 * Backfill `movies.keywords` from TMDB.
 *
 * One `/movie/{id}/keywords` request per film — there is no bulk endpoint, so
 * this is per-film work like trailers, providers and runtimes. Keywords exist to
 * fix plot search: TMDB overviews withhold the premise ("The Sixth Sense" never
 * says the boy sees dead people; "Titanic" never says "iceberg"), so whole
 * classes of query cannot retrieve the right film however good the model is.
 *
 * Resumable: `keywords_checked` marks a film TMDB has answered for, so the row is
 * the checkpoint and re-running picks up where it stopped. A film with no keywords
 * is recorded as checked with an empty string — "we asked" is not the same as
 * "there is nothing", and re-asking forever would be worse.
 *
 * Usage:
 *   npm run backfill:keywords                  # every film not yet checked
 *   npm run backfill:keywords -- --limit 50    # small batch
 *   npm run backfill:keywords -- --concurrency 8
 *
 * Target database: `DATABASE_URL` (env, then the repo-root `.env`), otherwise the
 * local docker database. Pass DATABASE_URL explicitly for production — the
 * default is local, and a run that fills dev while production stays empty is
 * exactly how the runtime column ended up empty in production.
 */
import { getPool, closePool } from "../src/db/pool.js";
import { logger } from "../src/logger.js";
import { getKeywords } from "../src/tmdb.js";

/** Consecutive failures before giving up: one dead film is normal, a run of them is a network problem. */
const CONSECUTIVE_FAILURE_LIMIT = 25;
const PROGRESS_EVERY = 250;

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
    const limit = Number(arg("limit") ?? 0);
    const concurrency = Number(arg("concurrency") ?? 8);
    const pool = getPool();

    // Most-voted first, so an interrupted run has covered the films people open.
    let sql = `SELECT tmdb_id FROM movies
                WHERE tmdb_id IS NOT NULL AND keywords_checked = false
                ORDER BY NULLIF(votes, '')::int DESC NULLS LAST, id ASC`;
    if (limit > 0) sql += ` LIMIT ${limit}`;

    const { rows: idRows } = await pool.query(sql);
    const ids = idRows.map((r) => Number(r.tmdb_id));
    if (ids.length === 0) {
        console.log("Nothing to do (every film has been checked for keywords).");
        return;
    }
    const { rows: target } = await pool.query("SELECT current_database() AS db, current_setting('port') AS port");
    console.log(
        `Checking ${ids.length} films for keywords (concurrency=${concurrency}) against ${target[0]?.db}:${target[0]?.port}`,
    );

    let done = 0;
    let filled = 0;
    let empty = 0;
    let failed = 0;
    let consecutiveFailures = 0;
    const started = Date.now();

    const queue = [...ids];
    const worker = async (): Promise<void> => {
        for (;;) {
            const tmdbId = queue.shift();
            if (tmdbId === undefined) return;
            if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) return;

            // Retries matter here: a single reset recorded as "no keywords" would be
            // permanent and wrong. See tmdbGet's attempts parameter.
            const { ok, keywords } = await getKeywords(tmdbId, 4);
            if (!ok) {
                // Unreachable: leave unchecked so a later run retries rather than
                // recording a wrong answer as final.
                failed += 1;
                consecutiveFailures += 1;
                continue;
            }
            consecutiveFailures = 0;
            const joined = keywords.join(", ");
            await pool.query(
                "UPDATE movies SET keywords = $1, keywords_checked = true WHERE tmdb_id = $2",
                [joined, tmdbId],
            );
            done += 1;
            if (joined) filled += 1;
            else empty += 1;
            if (done % PROGRESS_EVERY === 0) {
                const rate = done / Math.max((Date.now() - started) / 1000, 0.001);
                console.log(
                    `  ${done}/${ids.length} checked (${filled} with keywords, ${empty} without, ${failed} unreachable) — ${rate.toFixed(1)}/s`,
                );
            }
        }
    };

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
        `Done: ${done} checked, ${filled} with keywords, ${empty} without, ${failed} unreachable (${elapsed}s)`,
    );
    if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        console.error(
            `ABORTING: ${consecutiveFailures} films in a row were unreachable. TMDB is not answering from this host.`,
        );
        process.exitCode = 1;
    }
    logger.info({ done, filled, empty, failed }, "Keyword backfill finished");
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => closePool());
