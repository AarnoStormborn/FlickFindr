/**
 * A process-wide daily ceiling on requests that can invoke the language model.
 *
 * Per-IP rate limiting was the only guard, and it does not bound spend: the limits
 * are 120 requests/minute globally and 8/minute for chat, and *every* plot search
 * also calls the model once (the query rewrite), which is not obvious from the
 * outside. An abuser on a handful of IPs could therefore drain the provider balance
 * in an hour without ever exceeding a per-IP limit.
 *
 * Three deliberate properties:
 *
 *  - **Global, not per-IP.** The point is to bound the bill, so the counter is shared.
 *  - **In-memory.** Production runs a single instance and the value of this is an
 *    abuse guard, not accounting; a restart resets it, which is acceptable and far
 *    simpler than adding a datastore for it. Documented so nobody assumes otherwise.
 *  - **It degrades search rather than failing it.** When the budget is gone, plot
 *    search stops *rewriting* the query and searches what the user typed — which the
 *    eval set measures as equal or slightly better on well-formed queries — while
 *    the concierge, which cannot work without a model, returns 429.
 *
 * One unit is one model-backed request. A chat turn is several model calls, so the
 * limit is really "requests", not "calls"; the default is set well below what the
 * funded balance can absorb in a day either way.
 */
import { logger } from "../logger.js";

const LIMIT = Math.max(0, Number(process.env.AGENT_DAILY_BUDGET ?? 300));

/** UTC day key, so the window does not depend on the instance's local timezone. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

let currentDay = utcDay();
let used = 0;

/** Midnight UTC after `now` — when the counter next resets. */
function nextReset(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return d.toISOString();
}

/**
 * Take one unit if any remain.
 *
 * @returns true when the caller may call the model, false when the day's budget is
 *          spent and the caller should fall back or refuse.
 */
export function tryConsume(now: Date = new Date()): boolean {
  const day = utcDay(now);
  if (day !== currentDay) {
    currentDay = day;
    used = 0;
  }
  if (used >= LIMIT) return false;
  used += 1;
  if (used === LIMIT) {
    logger.warn({ limit: LIMIT, day }, "Daily agent budget reached; searches will use the raw query");
  }
  return true;
}

export interface BudgetSnapshot {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
}

export function budgetSnapshot(now: Date = new Date()): BudgetSnapshot {
  if (utcDay(now) !== currentDay) {
    currentDay = utcDay(now);
    used = 0;
  }
  return { limit: LIMIT, used, remaining: Math.max(0, LIMIT - used), resetsAt: nextReset(now) };
}

/** Test seam: the counter is module state, so tests must be able to clear it. */
export function resetBudget(): void {
  currentDay = utcDay();
  used = 0;
}
