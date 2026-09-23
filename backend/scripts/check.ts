/**
 * Environment health check / drift detector.
 *
 *   npm run check             report and warn; non-zero only if the DB is unreachable
 *   npm run check -- --strict non-zero on ANY warning (used by the runbook to
 *                             verify a freshly rebuilt database)
 *
 * Reports: DB reachability, catalogue size, per-area coverage (embeddings,
 * language, trailers), schema columns, and the resolved agent model.
 */

import { getPool, closePool } from "../src/db/pool.js";
import { resolveAgentModel, getModelRuntime } from "../src/agent/runtime.js";
import { config } from "../src/config.js";
import { logger } from "../src/logger.js";
import { EXPECTED_COLUMNS, assessCatalog } from "../src/services/health.js";

const STRICT = process.argv.includes("--strict");

function row<T>(rows: T[]): T | undefined {
  return rows[0];
}

async function main(): Promise<void> {
  const warnings: string[] = [];
  const report: Record<string, unknown> = { env: { dbPort: config.db.port, redis: config.redisUrl, port: config.port, agentEnabled: config.agent.enabled } };

  // --- Database ---
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    report.db = "reachable";

    try {
      // One pass for every coverage figure; each is a cheap FILTER over the same
      // seq scan, which beats four round trips on a remote pooler.
      const { rows: countRows } = await pool.query(`
        SELECT count(*)::int AS total,
               count(plot_embedding)::int AS with_embeddings,
               count(original_language)::int AS with_language,
               count(*) FILTER (WHERE trailer_checked)::int AS trailer_checked,
               count(trailer_key)::int AS with_trailer,
               count(*) FILTER (WHERE runtime_checked)::int AS runtime_checked
          FROM movies`);
      const { rows: colRows } = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'movies'",
      );
      const c = row(countRows) ?? {};
      const stats = {
        total: Number(c.total ?? 0),
        withEmbeddings: Number(c.with_embeddings ?? 0),
        withLanguage: Number(c.with_language ?? 0),
        trailerChecked: Number(c.trailer_checked ?? 0),
        withTrailer: Number(c.with_trailer ?? 0),
        runtimeChecked: Number(c.runtime_checked ?? 0),
        columns: colRows.map((r) => String(r.column_name)),
      };
      const assessment = assessCatalog(stats);
      report.catalog = {
        total_movies: stats.total,
        coverage: assessment.coverage,
        expected_columns_present: EXPECTED_COLUMNS.every((col) => stats.columns.includes(col)),
      };
      warnings.push(...assessment.warnings);
    } catch (err) {
      report.catalog = "missing";
      warnings.push("movies table does not exist — run npm run init:db");
      if (err instanceof Error) warnings.push(`  (${err.message})`);
    }
  } catch (err) {
    report.db = "UNREACHABLE";
    report.dbError = err instanceof Error ? err.message : String(err);
  }

  // --- Pi agent ---
  try {
    const runtime = await getModelRuntime();
    const available = await runtime.getAvailable();
    const resolved = await resolveAgentModel();
    report.agent = {
      model: config.agent.model ?? "auto (see fallbacks)",
      resolved_model: resolved ? `${resolved.provider}/${resolved.id}` : null,
      available_models: available.map((m) => `${m.provider}/${m.id}`),
    };
    if (available.length === 0) {
      warnings.push("no authenticated models — set COMMAND_CODE_API_KEY (see backend/pi-agent/models.json)");
    } else if (!resolved) {
      warnings.push("no model could be resolved for the agent");
    }
  } catch (err) {
    report.agent = { error: err instanceof Error ? err.message : String(err) };
  }

  if (warnings.length) report.warnings = warnings;
  logger.info(report, "Environment health check");
  await closePool();

  if (report.db !== "reachable") {
    logger.error("Critical: database unreachable (start it with: docker compose up -d postgres)");
    process.exit(1);
  }
  if (STRICT && warnings.length) {
    logger.error({ warnings }, "Strict check failed: the database is not fully built");
    process.exit(1);
  }
}

await main();