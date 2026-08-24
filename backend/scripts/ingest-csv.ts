/**
 * Load a processed movies CSV into the `movies` table.
 * Usage: npm run ingest -- <path-to-csv>
 *
 * Expected headers (subset ok, `movie_name` required):
 * movie_name, rating, runtime, genre, metascore, plot, directors, stars,
 * votes, gross, poster_url
 */

import fs from "node:fs";
import { getPool, closePool } from "../src/db/pool.js";
import { logger } from "../src/logger.js";

const COLUMNS = [
  "movie_name",
  "rating",
  "runtime",
  "genre",
  "metascore",
  "plot",
  "directors",
  "stars",
  "votes",
  "gross",
  "poster_url",
] as const;

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const [headerLine, ...rows] = lines;
  if (!headerLine) return [];
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return rows
    .filter((l) => l.trim())
    .map((line) => {
      const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const record: Record<string, string> = {};
      headers.forEach((h, i) => {
        record[h] = values[i] ?? "";
      });
      return record;
    });
}

async function main(): Promise<void> {
  const csvPath = process.argv[2];
  if (!csvPath) {
    logger.error("Usage: npm run ingest -- <path-to-csv>");
    process.exit(1);
  }
  const text = fs.readFileSync(csvPath, "utf8");
  const records = parseCsv(text);
  if (records.length === 0) {
    logger.error("No rows parsed from CSV");
    process.exit(1);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO movies (${COLUMNS.join(", ")})
      VALUES (${placeholders})
      ON CONFLICT DO NOTHING`;
    for (const record of records) {
      const values: (string | number | null)[] = COLUMNS.map((col) => {
        const raw = record[col] ?? "";
        if (col === "movie_name") return raw || null;
        if (["rating", "runtime", "metascore"].includes(col)) {
          const n = Number(raw);
          return raw === "" || Number.isNaN(n) ? null : n;
        }
        return raw === "" ? null : raw;
      });
      await client.query(sql, values);
    }
    await client.query("COMMIT");
    logger.info({ inserted: records.length }, "CSV ingestion complete");
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "CSV ingestion failed");
    throw err;
  } finally {
    client.release();
    await closePool();
  }
}

await main();