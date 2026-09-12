/**
 * Environment health check.
 * Usage: npm run check
 *
 * Reports: DB reachability, catalog size, embedding coverage, agent model.
 * Exits non-zero if anything critical is unreachable.
 */

import { getPool, closePool } from "../src/db/pool.js";
import { resolveAgentModel, getModelRuntime } from "../src/agent/runtime.js";
import { config } from "../src/config.js";
import { logger } from "../src/logger.js";

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
      const { rows: countRows } = await pool.query("SELECT count(*)::int AS n FROM movies");
      const total = Number(row(countRows)?.n ?? 0);
      const { rows: vecRows } = await pool.query("SELECT count(*)::int AS n FROM movies WHERE plot_embedding IS NOT NULL");
      const withVec = Number(row(vecRows)?.n ?? 0);
      report.catalog = { total_movies: total, with_embeddings: withVec };
      if (total === 0) warnings.push("movies table empty — run npm run ingest -- <csv>");
      if (withVec < total) warnings.push(`${total - withVec} movies missing embeddings — run npm run embeddings`);
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

  const ok = report.db === "reachable";
  if (!ok) {
    logger.error("Critical: database unreachable (start it with: docker compose up -d postgres)");
    process.exit(1);
  }
}

await main();