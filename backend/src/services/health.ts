/**
 * Catalogue health assessment.
 *
 * Production state was assembled by hand more than once (the language column
 * arrived after the catalogue, embeddings after that, trailers and languages by
 * separate jobs), and there was nothing to tell you a database was half-built:
 * a missing column or an empty coverage figure only showed up as a feature
 * quietly not working.
 *
 * This is the drift detector. It takes observed counts and reports what is
 * missing, with the command that fixes it. Pure and separate from the script
 * that queries Postgres, so the rules are unit-tested rather than trusted.
 */

/**
 * Columns the application expects to exist. A missing one means the database
 * predates a migration, which breaks a feature in a way that is easy to miss
 * (e.g. every detail page silently loses its language).
 */
export const EXPECTED_COLUMNS = [
  "id",
  "tmdb_id",
  "movie_name",
  "release_year",
  "original_language",
  "rating",
  "runtime",
  "genre",
  "plot",
  "plot_embedding",
  "trailer_key",
  "trailer_checked",
] as const;

/**
 * Share of the catalogue that must have been *checked* for a trailer.
 *
 * Not 100%: plenty of films genuinely have no trailer, so `withTrailer` is
 * expected to be below `trailerChecked` and is reported without complaint. What
 * matters is that TMDB was asked, which is what `trailer_checked` records.
 */
export const MIN_TRAILER_CHECKED_PCT = 90;

export interface CatalogStats {
  total: number;
  withEmbeddings: number;
  withLanguage: number;
  trailerChecked: number;
  withTrailer: number;
  /** Column names actually present, from information_schema. */
  columns: string[];
}

export interface Coverage {
  have: number;
  total: number;
  pct: number;
}

export interface CatalogAssessment {
  ok: boolean;
  warnings: string[];
  coverage: Record<"embeddings" | "language" | "trailer_checked" | "trailers", Coverage>;
}

function pct(have: number, total: number): number {
  return total > 0 ? Number(((100 * have) / total).toFixed(1)) : 0;
}

export function assessCatalog(stats: CatalogStats): CatalogAssessment {
  const { total } = stats;
  const warnings: string[] = [];

  const coverage = {
    embeddings: { have: stats.withEmbeddings, total, pct: pct(stats.withEmbeddings, total) },
    language: { have: stats.withLanguage, total, pct: pct(stats.withLanguage, total) },
    trailer_checked: { have: stats.trailerChecked, total, pct: pct(stats.trailerChecked, total) },
    trailers: { have: stats.withTrailer, total, pct: pct(stats.withTrailer, total) },
  };

  if (total === 0) {
    warnings.push("catalogue is empty — load it (tools/load-backend/load.py, or npm run fetch:movies)");
    return { ok: false, warnings, coverage };
  }

  const present = new Set(stats.columns);
  const missing = EXPECTED_COLUMNS.filter((c) => !present.has(c));
  if (missing.length) {
    warnings.push(
      `schema is behind: missing column(s) ${missing.join(", ")} — run npm run init:db against this database`,
    );
  }

  // Embeddings and language are per-row properties of the curated catalogue, so
  // anything less than complete is a real gap rather than a natural absence.
  if (stats.withEmbeddings < total) {
    warnings.push(
      `${total - stats.withEmbeddings} films have no embedding and cannot be found by plot search — run npm run embeddings`,
    );
  }
  if (stats.withLanguage < total) {
    warnings.push(
      `${total - stats.withLanguage} films have no language and are hidden by every language filter — run npm run backfill:languages`,
    );
  }

  if (coverage.trailer_checked.pct < MIN_TRAILER_CHECKED_PCT) {
    warnings.push(
      `only ${coverage.trailer_checked.pct}% of films have been checked for a trailer (expected >= ${MIN_TRAILER_CHECKED_PCT}%) — run the trailer load`,
    );
  }

  return { ok: warnings.length === 0, warnings, coverage };
}
