/**
 * Initialize the FlickFindr database schema (idempotent):
 *   1. Enable the pgvector extension
 *   2. Create the `movies` table if it does not exist
 *
 * Usage: npm run init:db
 * Run after `docker compose up -d postgres`, before the first CSV ingest.
 */

import { getPool, closePool } from "../src/db/pool.js";
import { logger } from "../src/logger.js";

async function main(): Promise<void> {
  const pool = getPool();
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS movies (
        id SERIAL PRIMARY KEY,
        tmdb_id INTEGER UNIQUE,
        movie_name VARCHAR(255) NOT NULL,
        release_year INTEGER,
        rating FLOAT,
        runtime INTEGER,
        genre TEXT,
        metascore FLOAT,
        plot TEXT,
        directors TEXT,
        stars TEXT,
        votes VARCHAR(20),
        gross VARCHAR(20),
        poster_url TEXT,
        plot_embedding vector(384)
      )
    `);
    // Migration for pre-existing databases (idempotent).
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS tmdb_id INTEGER");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS release_year INTEGER");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS trailer_key TEXT");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS trailer_source TEXT");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS trailer_checked BOOLEAN NOT NULL DEFAULT false");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS original_language TEXT");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS watch_providers JSONB");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS providers_checked BOOLEAN NOT NULL DEFAULT false");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS providers_updated_at TIMESTAMPTZ");
    // "We asked TMDB" for a runtime, kept separate from the value itself. The
    // first attempt at this backfill wrote runtime = 0 for films TMDB had no
    // runtime for, which is indistinguishable from a real 0-minute film and made
    // those rows match an `under N minutes` filter. Same contract as
    // trailer_checked / providers_checked: failure is not recorded as data.
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS runtime_checked BOOLEAN NOT NULL DEFAULT false");
    // TMDB keyword names, comma-joined, plus the "we asked" flag. Keywords carry
    // the premise that TMDB's short overview deliberately withholds ("iceberg",
    // "ghost"), so they are what make some queries retrievable at all.
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS keywords TEXT");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS keywords_checked BOOLEAN NOT NULL DEFAULT false");
    // A second vector, searched alongside plot_embedding and combined at query
    // time. Kept separate because blending keywords *into* the plot document
    // displaces it: measured, that gained six queries and lost six.
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS keywords_embedding vector(384)");
    // Plain unique index (NULLs allowed — they are distinct), so
    // ON CONFLICT (tmdb_id) resolves. Replaces any older partial index.
    await pool.query("DROP INDEX IF EXISTS idx_movies_tmdb_id");
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_movies_tmdb_id ON movies (tmdb_id)");
    await pool.query("CREATE INDEX IF NOT EXISTS idx_movies_name ON movies (movie_name)");
    await pool.query("CREATE INDEX IF NOT EXISTS idx_movies_language ON movies (original_language)");
    logger.info("Database schema ready (pgvector extension + movies table)");
  } catch (err) {
    logger.error({ err }, "Schema init failed");
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

await main();