import pg from "pg";
import { config } from "../config.js";
import type { Queryable } from "../models.js";

const { Pool } = pg;

let pool: pg.Pool | undefined;

/** Lazily-created pg Pool. Not connected until first query. */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl() });
  }
  return pool;
}

/** Adapter so the pg Pool satisfies the Queryable contract used by services. */
export const db: Queryable = {
  async query(sql: string, params?: unknown[]) {
    return getPool().query(sql, params as never[] | undefined);
  },
};

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}