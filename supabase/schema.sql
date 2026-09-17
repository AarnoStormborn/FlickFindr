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
  original_language text
);

create unique index if not exists idx_movies_tmdb_id on movies (tmdb_id);
create index if not exists idx_movies_name on movies (movie_name);
-- Language is a common filter combined with sort-by-rating, so index it.
create index if not exists idx_movies_language on movies (original_language);

-- Optional but recommended for vector search speed at 30k rows.
create index if not exists idx_movies_embedding
  on movies using hnsw (plot_embedding vector_cosine_ops);
