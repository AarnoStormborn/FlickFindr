-- FlickFindr schema for Supabase (Postgres + pgvector).
-- Run this in the Supabase SQL editor once, OR just run:
--   DATABASE_URL=<supabase-connection-string> npm run init:db  (in backend/)
-- (init-db.ts does exactly this, idempotently.)

create extension if not exists vector;

create table if not exists movies (
  id serial primary key,
  tmdb_id integer unique,
  movie_name varchar(255) not null,
  release_year integer,
  rating float,
  runtime integer,
  -- "TMDB was asked for a runtime", separate from the value: a film TMDB has no
  -- runtime for keeps runtime NULL rather than being recorded as 0 minutes.
  runtime_checked boolean not null default false,
  genre text,
  metascore float,
  plot text,
  directors text,
  stars text,
  votes varchar(20),
  gross varchar(20),
  poster_url text,
  plot_embedding vector(384),
  trailer_key text,
  trailer_source text,
  trailer_checked boolean not null default false,
  -- TMDB `original_language` (2-letter ISO code, e.g. 'en', 'hi', 'fr').
  -- Nullable: rows predating the backfill, and any movie TMDB no longer
  -- reports, stay NULL and are treated as "unknown" by the language filter.
  original_language text,
  -- Where to watch, for the configured regions only, shaped:
  --   { "IN": { link, flatrate: [{id,name,logo}], rent: [...], buy: [...] }, "US": {...} }
  -- TMDB returns ~112 regions in ONE request; we keep the handful we serve so
  -- a row stays a couple of KB. One fetch fills every region, so this is not
  -- per-region work.
  watch_providers jsonb,
  -- Same rule as trailers: true means TMDB ANSWERED (even if it answered
  -- "nothing available"). A failed fetch must stay false so it retries.
  providers_checked boolean not null default false,
  providers_updated_at timestamptz
);

create unique index if not exists idx_movies_tmdb_id on movies (tmdb_id);
create index if not exists idx_movies_name on movies (movie_name);
-- Language is a common filter combined with sort-by-rating, so index it.
create index if not exists idx_movies_language on movies (original_language);

-- Optional but recommended for vector search speed at 30k rows.
create index if not exists idx_movies_embedding
  on movies using hnsw (plot_embedding vector_cosine_ops);
