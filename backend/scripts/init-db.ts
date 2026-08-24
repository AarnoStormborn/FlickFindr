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
        movie_name VARCHAR(255) NOT NULL,
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
    await pool.query("CREATE INDEX IF NOT EXISTS idx_movies_name ON movies (movie_name)");
    logger.info("Database schema ready (pgvector extension + movies table)");
  } catch (err) {
    logger.error({ err }, "Schema init failed");
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

await main();