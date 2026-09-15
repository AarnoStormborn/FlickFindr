import { defineConfig } from "vitest/config";

/**
 * Coverage thresholds act as a ratchet: they sit just under the current numbers
 * so measured coverage cannot silently regress, without being so tight that
 * ordinary refactors break CI. Raise them as coverage improves.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**"],
      // Bootstrap plus the two infrastructure seams that can only be exercised
      // against a live Postgres / loaded embedding model (covered by
      // `npm run check` and the deploy smoke tests, not unit tests).
      exclude: ["src/index.ts", "src/db/pool.ts", "src/embedding.ts"],
      thresholds: {
        lines: 65,
        statements: 65,
        functions: 63,
        branches: 60,
      },
    },
  },
});
