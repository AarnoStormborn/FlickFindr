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
import { logger } from "../src/logger.js";

const BATCH_SIZE = 32; // model batch
const COMMIT_EVERY = 500; // rows per transaction

async function main(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id, plot FROM movies WHERE plot IS NOT NULL AND plot != '' AND plot_embedding IS NULL ORDER BY id",
  );
  const total = rows.length;
  logger.info({ rows: total }, "Plots needing embeddings");

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
      const texts = chunk.map((r) => String(r.plot ?? ""));
      const vectors = await batchGenerateEmbeddings(texts, BATCH_SIZE);

      await client.query("BEGIN");
      for (let k = 0; k < chunk.length; k++) {
        const id = Number(chunk[k]!.id);
        const vec = `[${(vectors[k] ?? []).join(",")}]`;
        await client.query(
          "UPDATE movies SET plot_embedding = $1::vector WHERE id = $2",
          [vec, id],
        );
      }
      await client.query("COMMIT");
      done += chunk.length;
      if (done % COMMIT_EVERY === 0 || done === total) {
        logger.info({ done, total }, `Embedded ${done}/${total}`);
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
