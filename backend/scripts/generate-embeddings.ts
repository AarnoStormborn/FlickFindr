/**
 * Generate embeddings for all movie plots and store them in the
 * `plot_embedding` pgvector column. Fastify-era port of the old Python
 * script — run after ingesting data (and re-run after the TS migration to
 * refresh vectors, since library versions may differ slightly).
 *
 * Usage: npm run embeddings
 */

import { getPool, closePool } from "../src/db/pool.js";
import { batchGenerateEmbeddings, EMBEDDING_DIM } from "../src/embedding.js";
import { logger } from "../src/logger.js";

async function main(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id, plot FROM movies WHERE plot IS NOT NULL AND plot != ''",
  );
  logger.info({ rows: rows.length }, "Plots to embed");

  const ids = rows.map((r) => Number(r.id));
  const texts = rows.map((r) => String(r.plot ?? ""));
  const embeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    embeddings.push(...(await batchGenerateEmbeddings(texts.slice(i, i + 32))));
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const embedding = embeddings[i];
      if (embedding === undefined) continue;
      const vec = `[${embedding.join(",")}]`;
      await client.query("UPDATE movies SET plot_embedding = $1::vector WHERE id = $2", [vec, id]);
    }
    await client.query("COMMIT");
    logger.info({ updated: ids.length, dim: EMBEDDING_DIM }, "Embeddings stored");
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Embedding storage failed");
    throw err;
  } finally {
    client.release();
    await closePool();
  }
}

await main();