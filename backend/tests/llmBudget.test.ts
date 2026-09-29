import { afterEach, describe, expect, it } from "vitest";
import { budgetSnapshot, resetBudget, tryConsume, utcDay } from "../src/services/llmBudget.js";

/**
 * The only guard that bounds *spend* rather than burst rate: per-IP rate limiting
 * cannot bound a bill, because every plot search also calls the model and an abuser
 * on a few IPs never trips a per-IP ceiling. These pin the three properties that
 * make it a spend guard: it is global, it resets on a UTC boundary, and it refuses
 * only when the day is genuinely spent.
 */
describe("llmBudget", () => {
    afterEach(() => resetBudget());

    it("allows requests up to the daily limit, then refuses", () => {
        resetBudget();
        const { limit } = budgetSnapshot();
        expect(limit).toBeGreaterThan(0);
        for (let i = 0; i < limit; i += 1) {
            expect(tryConsume(), `request ${i + 1} of ${limit}`).toBe(true);
        }
        expect(tryConsume()).toBe(false);
        expect(budgetSnapshot().remaining).toBe(0);
    });

    it("resets on a new UTC day", () => {
        resetBudget();
        const { limit } = budgetSnapshot();
        for (let i = 0; i < limit; i += 1) tryConsume();
        expect(tryConsume()).toBe(false);

        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        expect(tryConsume(tomorrow)).toBe(true);
        expect(budgetSnapshot(tomorrow).used).toBe(1);
    });

    it("keys the window on UTC, not the instance's local time", () => {
        // Two instants either side of a UTC midnight are different days even if the
        // machine's timezone would call them the same one.
        expect(utcDay(new Date("2026-01-02T23:59:59Z"))).toBe("2026-01-02");
        expect(utcDay(new Date("2026-01-03T00:00:01Z"))).toBe("2026-01-03");
    });

    it("reports the reset time and never a negative remainder", () => {
        resetBudget();
        const snap = budgetSnapshot(new Date("2026-01-02T05:00:00Z"));
        expect(snap.resetsAt).toBe("2026-01-03T00:00:00.000Z");
        expect(snap.remaining).toBe(snap.limit - snap.used);
        expect(snap.remaining).toBeGreaterThanOrEqual(0);
    });
});
