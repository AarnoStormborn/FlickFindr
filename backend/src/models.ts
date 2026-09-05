import { z } from "zod";

/**
 * Shared request/response models and row shapes.
 * Validation mirrors the old pydantic models (ranges, optional filters).
 */

export const SortableFields = ["rating", "runtime", "movie_name", "metascore"] as const;
export type SortByField = (typeof SortableFields)[number];

export const SortOrderSchema = z.enum(["asc", "desc"]).default("desc");
export const SortBySchema = z.enum(SortableFields).default("rating");

export const StructuralSearchRequestSchema = z.object({
  query: z.string().min(1).optional(),
  genre: z.string().min(1).optional(),
  directors: z.string().min(1).optional(),
  stars: z.string().min(1).optional(),
  min_rating: z.number().min(0).max(10).optional(),
  max_rating: z.number().min(0).max(10).optional(),
  min_runtime: z.number().int().min(0).optional(),
  max_runtime: z.number().int().min(0).optional(),
  sort_by: SortBySchema,
  sort_order: SortOrderSchema,
  skip: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(10),
});
export type StructuralSearchRequest = z.infer<typeof StructuralSearchRequestSchema>;

export const SemanticSearchRequestSchema = z.object({
  query: z.string().min(3),
  limit: z.number().int().min(1).max(100).default(10),
});
export type SemanticSearchRequest = z.infer<typeof SemanticSearchRequestSchema>;

export const HybridSearchRequestSchema = z.object({
  query: z.string().min(3),
  genre: z.string().min(1).optional(),
  directors: z.string().min(1).optional(),
  stars: z.string().min(1).optional(),
  min_rating: z.number().min(0).max(10).optional(),
  max_rating: z.number().min(0).max(10).optional(),
  min_runtime: z.number().int().min(0).optional(),
  max_runtime: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).default(10),
});
export type HybridSearchRequest = z.infer<typeof HybridSearchRequestSchema>;

/** Shape of a row from the `movies` table. */
export interface MovieRow {
  id: number;
  movie_name: string;
  release_year: number | null;
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
  limit: number;
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

/** Minimal query runner contract so services can be tested without pg. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: RowLike[] }>;
}

export type RowLike = Record<string, unknown>;