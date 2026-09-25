/**
 * Generate embeddings for movie plots and store them, BATCHED for remote DBs
 * (Supabase). Unlike generate-embeddings.ts (one giant final transaction),
 * this commits every COMMIT_EVERY rows so progress is visible, resumable,
 * and won't stall on a long network transaction.
 *
 * Resumable: only processes rows whose plot_embedding IS NULL.
 *
 * Usage: DATABASE_URL=<...> npm run embeddings:remote
 */

import { getPool, closePool } from "../src/db/pool.js";
import { batchGenerateEmbeddings, EMBEDDING_DIM } from "../src/embedding.js";
import { keywordText, plotText } from "../src/services/embeddingText.js";
import { logger } from "../src/logger.js";

const BATCH_SIZE = 32; // model batch
const COMMIT_EVERY = 500; // rows per transaction

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * A full re-embed, for when the embedded document itself changes (keywords,
 * title, genre). Without `--all` this only fills gaps, which is the normal case.
 *
 * Resuming a long re-embed: progress is logged with the last id written, so pass
 * `--from-id` to continue rather than starting over.
 */
const ALL = process.argv.includes("--all");
const FROM_ID = Number(arg("from-id") ?? 0);

async function main(): Promise<void> {
  const pool = getPool();
  // The document is built by embeddingText(), shared with the local generator so
  // the two can never disagree about what a vector means.
  const columns = "id, movie_name, release_year, genre, keywords, plot";
  const conditions = ["id >= $1"];
  if (!ALL) conditions.push("plot_embedding IS NULL");
  const { rows } = await pool.query(
    `SELECT ${columns} FROM movies WHERE ${conditions.join(" AND ")} ORDER BY id`,
    [FROM_ID],
  );
  const total = rows.length;
  logger.info({ rows: total, all: ALL, fromId: FROM_ID }, "Films needing embeddings");

  if (total === 0) {
    logger.info("Nothing to embed.");
    await closePool();
    return;
  }

  let done = 0;
  const client = await pool.connect();
  try {
    for (let i = 0; i < total; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      // Two documents per film, two columns (see src/services/embeddingText.ts).
      const plotTexts = chunk.map((r) => plotText(r));
      const keywordTexts = chunk.map((r) => keywordText(r));
      const vectors = await batchGenerateEmbeddings(plotTexts, BATCH_SIZE);
      const keywordVectors = await batchGenerateEmbeddings(keywordTexts, BATCH_SIZE);

      // One statement per chunk, not one per row: against a remote pooler a
      // per-row UPDATE is a network round trip each. Measured on a full
      // re-embed of the catalogue: 3.8 rows/s that way, 26.7 rows/s this way.
      const ids = chunk.map((r) => Number(r.id));
      const plotVecs = chunk.map((_, k) => `[${(vectors[k] ?? []).join(",")}]`);
      // NULL (not a zero vector) when there is no keyword document at all.
      const kwVecs = chunk.map((_, k) => (keywordTexts[k] ? `[${(keywordVectors[k] ?? []).join(",")}]` : null));

      await client.query("BEGIN");
      await client.query(
        `UPDATE movies m
            SET plot_embedding = d.plot::vector,
                keywords_embedding = d.kw::vector
           FROM (SELECT unnest($1::int[]) AS id,
                        unnest($2::text[]) AS plot,
                        unnest($3::text[]) AS kw) d
          WHERE m.id = d.id`,
        [ids, plotVecs, kwVecs],
      );
      await client.query("COMMIT");
      done += chunk.length;
      if (done % COMMIT_EVERY === 0 || done === total) {
        const lastId = Number(chunk[chunk.length - 1]?.id ?? 0);
        logger.info({ done, total, lastId }, `Embedded ${done}/${total} (resume with --from-id ${lastId + 1})`);
      }
    }
    logger.info({ updated: done, dim: EMBEDDING_DIM }, "Embeddings stored");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "Embedding run failed (resumable — re-run to continue)");
    process.exitCode = 1;
  } finally {
    client.release();
    await closePool();
  }
}

await main();
