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
import { keywordText, plotText } from "../src/services/embeddingText.js";
import { logger } from "../src/logger.js";

async function main(): Promise<void> {
  const pool = getPool();
  // The document is built by embeddingText(), shared with the remote generator so
  // the two can never disagree about what a vector means.
  const { rows } = await pool.query(
    "SELECT id, movie_name, release_year, genre, keywords, plot FROM movies ORDER BY id",
  );
  logger.info({ rows: rows.length }, "Films to embed (plot + keyword vectors)");

  const ids = rows.map((r) => Number(r.id));
  // Two documents per film, two columns. See src/services/embeddingText.ts.
  const plotTexts = rows.map((r) => plotText(r));
  const keywordTexts = rows.map((r) => keywordText(r));
  const embeddings: number[][] = [];
  const keywordEmbeddings: number[][] = [];
  for (let i = 0; i < plotTexts.length; i += 32) {
    embeddings.push(...(await batchGenerateEmbeddings(plotTexts.slice(i, i + 32))));
    keywordEmbeddings.push(...(await batchGenerateEmbeddings(keywordTexts.slice(i, i + 32))));
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const embedding = embeddings[i];
      const keywordEmbedding = keywordEmbeddings[i];
      if (embedding === undefined) continue;
      const vec = `[${embedding.join(",")}]`;
      // An empty keyword document means no title/genre/keywords: store NULL rather
      // than a zero vector, so the keyword term is skipped (COALESCE to 0) instead
      // of contributing a meaningless similarity.
      const kwVec = keywordEmbedding && keywordTexts[i] ? `[${keywordEmbedding.join(",")}]` : null;
      await client.query(
        "UPDATE movies SET plot_embedding = $1::vector, keywords_embedding = $2::vector WHERE id = $3",
        [vec, kwVec, id],
      );
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