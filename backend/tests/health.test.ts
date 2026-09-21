import { describe, expect, it } from "vitest";
import { EXPECTED_COLUMNS, MIN_TRAILER_CHECKED_PCT, assessCatalog } from "../src/services/health.js";

/**
 * The drift detector. Production state was assembled by hand more than once
 * (trailers, then embeddings, then language), and nothing told you a database
 * was half-built — a missing column or a 0.4% coverage figure only surfaced as
 * a feature quietly not working.
 */

const ALL_COLUMNS = [...EXPECTED_COLUMNS];

const full = (over: Partial<Parameters<typeof assessCatalog>[0]> = {}) => ({
  total: 30_749,
  withEmbeddings: 30_749,
  withLanguage: 30_749,
  trailerChecked: 30_749,
  withTrailer: 25_096,
  columns: ALL_COLUMNS,
  ...over,
});

describe("assessCatalog", () => {
  it("passes a fully built catalogue", () => {
    const result = assessCatalog(full());
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("does not flag films that simply have no trailer", () => {
    // 81.6% have a trailer, 100% were checked — the real production shape.
    // `trailer_checked` is the completeness signal; complaining about
    // `withTrailer` would cry wolf forever.
    const result = assessCatalog(full({ withTrailer: 1 }));
    expect(result.ok).toBe(true);
    expect(result.coverage.trailers.pct).toBe(0);
  });

  it("reports coverage percentages", () => {
    const result = assessCatalog(full({ withLanguage: 15_375 }));
    expect(result.coverage.language).toEqual({ have: 15_375, total: 30_749, pct: 50 });
  });

  it("flags an empty catalogue as not ok", () => {
    const result = assessCatalog(full({ total: 0, withEmbeddings: 0, withLanguage: 0, trailerChecked: 0, withTrailer: 0 }));
    expect(result.ok).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/empty/i);
  });

  it("names missing columns as schema drift", () => {
    const result = assessCatalog(full({ columns: ALL_COLUMNS.filter((c) => c !== "original_language") }));
    expect(result.ok).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/original_language/);
    expect(result.warnings.join(" ")).toMatch(/init:db/);
  });

  it("flags missing embeddings with the count and the fix", () => {
    const result = assessCatalog(full({ withEmbeddings: 30_000 }));
    expect(result.warnings.join(" ")).toMatch(/749 films have no embedding/);
    expect(result.warnings.join(" ")).toMatch(/npm run embeddings/);
  });

  it("flags missing language with the count and the fix", () => {
    const result = assessCatalog(full({ withLanguage: 28_346 }));
    expect(result.warnings.join(" ")).toMatch(/2403 films have no language/);
    expect(result.warnings.join(" ")).toMatch(/backfill:languages/);
  });

  it("flags a catalogue that was largely never checked for trailers", () => {
    // The local database's actual state when prod was already complete.
    const result = assessCatalog(full({ trailerChecked: 110, withTrailer: 109 }));
    expect(result.ok).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/trailer/i);
  });

  it("accepts coverage exactly at the trailer threshold", () => {
    const checked = Math.ceil((MIN_TRAILER_CHECKED_PCT / 100) * 30_749);
    const result = assessCatalog(full({ trailerChecked: checked }));
    expect(result.warnings.join(" ")).not.toMatch(/checked for a trailer/);
  });

  it("treats a zero-row database as 0% rather than dividing by zero", () => {
    const result = assessCatalog(full({ total: 0, withEmbeddings: 0, withLanguage: 0, trailerChecked: 0, withTrailer: 0 }));
    for (const value of Object.values(result.coverage)) {
      expect(value.pct).toBe(0);
      expect(Number.isFinite(value.pct)).toBe(true);
    }
  });

  it("reports every problem at once rather than stopping at the first", () => {
    const result = assessCatalog(
      full({ columns: ["id"], withEmbeddings: 0, withLanguage: 0, trailerChecked: 0, withTrailer: 0 }),
    );
    expect(result.warnings.length).toBeGreaterThanOrEqual(4);
  });
});
