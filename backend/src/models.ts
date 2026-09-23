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
 * How deep any single search may paginate.
 *
 * The catalogue is ~31k films, and the browse experience is a ranked
 * recommendation list, not an index: paging past a few hundred results is never
 * useful and invites scraping the whole table one page at a time. Callers may
 * request at most this many results in total (skip must land inside the window);
 * the UI surfaces "Top 100" rather than "30,749 matches".
 */
export const MAX_RESULTS = 100;

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
  /** TMDB `original_language` code, e.g. "en", "hi", "fr". */
  language: z.string().min(2).max(8).optional(),
  sort_by: SortBySchema,
  sort_order: SortOrderSchema,
  skip: z.number()
    .int()
    .min(0)
    // Expressed as "the window", not "<=99": the default zod message for an
    // off-by-one bound reads like a bug report rather than a product rule.
    .max(MAX_RESULTS - 1, { message: `Pagination is capped at the first ${MAX_RESULTS} results` })
    .default(0),
  limit: z.number().int().min(1).max(100).default(10),
});
export type StructuralSearchRequest = z.infer<typeof StructuralSearchRequestSchema>;

export const SemanticSearchRequestSchema = z.object({
  query: z.string().min(3),
  skip: z.number()
    .int()
    .min(0)
    // Expressed as "the window", not "<=99": the default zod message for an
    // off-by-one bound reads like a bug report rather than a product rule.
    .max(MAX_RESULTS - 1, { message: `Pagination is capped at the first ${MAX_RESULTS} results` })
    .default(0),
  limit: z.number().int().min(1).max(100).default(10),
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
    .max(MAX_RESULTS - 1, { message: `Pagination is capped at the first ${MAX_RESULTS} results` })
    .default(0),
  limit: z.number().int().min(1).max(100).default(10),
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