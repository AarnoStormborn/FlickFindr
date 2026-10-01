import { z } from "zod";

/**
 * Shared request/response models and row shapes.
 * Validation mirrors the old pydantic models (ranges, optional filters).
 */

export const SortableFields = ["rating", "runtime", "movie_name", "metascore", "release_year"] as const;
export type SortByField = (typeof SortableFields)[number];

export const SortOrderSchema = z.enum(["asc", "desc"]).default("desc");
export const SortBySchema = z.enum(SortableFields).default("rating");

/**
 * The largest page any single request may return.
 *
 * This is the bound that matters for safety: without it a caller could ask for
 * `limit=100000` and pull the entire table in one response. Depth is *not* capped —
 * paging through a genre is a legitimate thing to want, and the ranked sort is
 * computed per query either way, so a deep page costs about what the first one does.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * A sanity bound on `skip`, not a product limit.
 *
 * It exists so absurd input is rejected with a 400 rather than handed to Postgres as
 * an enormous OFFSET; the catalogue is ~31k films, so nothing a viewer does comes near
 * it.
 */
export const MAX_SKIP = 1_000_000;

export const StructuralSearchRequestSchema = z.object({
  query: z.string().min(1).optional(),
  genre: z.string().min(1).optional(),
  directors: z.string().min(1).optional(),
  stars: z.string().min(1).optional(),
  min_rating: z.number().min(0).max(10).optional(),
  max_rating: z.number().min(0).max(10).optional(),
  min_runtime: z.number().int().min(0).optional(),
  max_runtime: z.number().int().min(0).optional(),
  min_year: z.number().int().min(1880).max(2100).optional(),
  max_year: z.number().int().min(1880).max(2100).optional(),
  min_votes: z.number().int().min(0).optional(),
  max_votes: z.number().int().min(0).optional(),
  /** TMDB `original_language` code, e.g. "en", "hi", "fr". */
  language: z.string().min(2).max(8).optional(),
  sort_by: SortBySchema,
  sort_order: SortOrderSchema,
  skip: z.number()
    .int()
    .min(0)
    // Expressed as "the window", not "<=99": the default zod message for an
    // off-by-one bound reads like a bug report rather than a product rule.
    .max(MAX_SKIP, { message: `Pagination is capped at ${MAX_SKIP.toLocaleString()} results` })
    .default(0),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(10),
});
export type StructuralSearchRequest = z.infer<typeof StructuralSearchRequestSchema>;

export const SemanticSearchRequestSchema = z.object({
  query: z.string().min(3),
  skip: z.number()
    .int()
    .min(0)
    // Expressed as "the window", not "<=99": the default zod message for an
    // off-by-one bound reads like a bug report rather than a product rule.
    .max(MAX_SKIP, { message: `Pagination is capped at ${MAX_SKIP.toLocaleString()} results` })
    .default(0),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(10),
});
export type SemanticSearchRequest = z.infer<typeof SemanticSearchRequestSchema>;

export const HybridSearchRequestSchema = z.object({
  query: z.string().min(3),
  genre: z.string().min(1).optional(),
  directors: z.string().min(1).optional(),
  stars: z.string().min(1).optional(),
  language: z.string().min(2).max(8).optional(),
  min_rating: z.number().min(0).max(10).optional(),
  max_rating: z.number().min(0).max(10).optional(),
  min_runtime: z.number().int().min(0).optional(),
  max_runtime: z.number().int().min(0).optional(),
  skip: z.number()
    .int()
    .min(0)
    // Expressed as "the window", not "<=99": the default zod message for an
    // off-by-one bound reads like a bug report rather than a product rule.
    .max(MAX_SKIP, { message: `Pagination is capped at ${MAX_SKIP.toLocaleString()} results` })
    .default(0),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(10),
});
export type HybridSearchRequest = z.infer<typeof HybridSearchRequestSchema>;

/** Shape of a row from the `movies` table. */
export interface MovieRow {
  id: number;
  movie_name: string;
  release_year: number | null;
  original_language: string | null;
  rating: number | null;
  runtime: number | null;
  genre: string | null;
  metascore: number | null;
  plot: string | null;
  directors: string | null;
  stars: string | null;
  votes: string | null;
  gross: string | null;
  poster_url: string | null;
  plot_embedding?: number[] | null;
}

export interface MovieResult extends Omit<MovieRow, "plot_embedding"> {
  similarity_score?: number | null;
  /**
   * Vote-weighted rating, the key results are ranked by when sorting by rating.
   * Sent so clients can preserve that ranking when merging result sets.
   */
  weighted_rating?: number | null;
}

export interface SearchResponse {
  results: MovieResult[];
  total: number;
  skip: number;
  limit: number;
  has_more: boolean;
}

export interface SemanticSearchResponse {
  results: MovieResult[];
  query: string;
  skip: number;
  limit: number;
  total: number;
  has_more: boolean;
  exact_matches: boolean;
  message: string;
}

export interface MovieStats {
  min_rating: number;
  max_rating: number;
  min_runtime: number;
  max_runtime: number;
  total_movies: number;
}

export interface GenreItem {
  name: string;
  count: number;
}

/** A language facet entry: TMDB `original_language` code + how many films. */
export interface LanguageItem {
  code: string;
  count: number;
}

/** Minimal query runner contract so services can be tested without pg. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: RowLike[] }>;
}

export type RowLike = Record<string, unknown>;