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
    // Third-party ratings (IMDb/RT/Metacritic) via OMDb, fetched on demand and cached.
    // Same contract as providers: "we asked" is recorded, a failure is not.
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS external_ratings JSONB");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS ratings_checked BOOLEAN NOT NULL DEFAULT false");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS ratings_updated_at TIMESTAMPTZ");
    // Per-user local-first sync snapshot for lists, search history and concierge
    // transcript. `user_id` is always sourced from the verified Supabase token in the
    // API, never from the request body. RLS policies are installed when running on
    // Supabase; local Postgres has no auth.uid() function and uses the same explicit
    // user_id predicate in the API instead.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sync_data (
        user_id UUID PRIMARY KEY,
        data JSONB NOT NULL,
        revision BIGINT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query("ALTER TABLE user_sync_data ENABLE ROW LEVEL SECURITY");
    await pool.query(`
      DO $$ BEGIN
        IF to_regclass('auth.users') IS NOT NULL THEN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conname = 'user_sync_data_user_id_fkey'
               AND conrelid = 'user_sync_data'::regclass
          ) THEN
            EXECUTE 'ALTER TABLE user_sync_data ADD CONSTRAINT user_sync_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE';
          END IF;
          EXECUTE 'DROP POLICY IF EXISTS user_sync_data_owner ON user_sync_data';
          EXECUTE 'CREATE POLICY user_sync_data_owner ON user_sync_data USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
          EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON user_sync_data TO authenticated';
        END IF;
      END $$
    `);
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
    // Third-party ratings (IMDb/RT/Metacritic) via OMDb, fetched on demand and cached.
    // Same contract as watch_providers: `ratings_checked` records "we asked", so a
    // transient failure is never stored as "this film has no ratings".
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS external_ratings JSONB");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS ratings_checked BOOLEAN NOT NULL DEFAULT false");
    await pool.query("ALTER TABLE movies ADD COLUMN IF NOT EXISTS ratings_updated_at TIMESTAMPTZ");
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