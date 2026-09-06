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
  plot_embedding vector(384)
);

create unique index if not exists idx_movies_tmdb_id on movies (tmdb_id);
create index if not exists idx_movies_name on movies (movie_name);

-- Optional but recommended for vector search speed at 30k rows.
create index if not exists idx_movies_embedding
  on movies using hnsw (plot_embedding vector_cosine_ops);
