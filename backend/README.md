# FlickFindr Backend (TypeScript)

Fastify API for FlickFindr — movie search with structural, semantic and hybrid
search over PostgreSQL + pgvector. Natural-language queries and chat run
through **Pi SDK agents** (`@earendil-works/pi-coding-agent`).

## Stack

- **Framework:** Fastify 5 (+ `@fastify/cors`)
- **DB:** PostgreSQL 16 with pgvector (`pg` driver, raw SQL)
- **Embeddings:** `@huggingface/transformers` — `Xenova/all-MiniLM-L6-v2` (384-dim), lazy-loaded
- **Agents:** Pi SDK — query interpretation for semantic/hybrid search, and a streaming chat assistant
- **Validation:** zod request schemas
- **Tests:** vitest (services + HTTP via `fastify.inject`, deps injected)

## Layout

```
src/
├── index.ts            # entrypoint
├── app.ts              # buildApp(deps) — Fastify assembly, DI-friendly
├── config.ts           # env config (dev defaults, no .env required)
├── models.ts           # zod schemas, types, Queryable contract
├── embedding.ts        # transformers.js embedding pipeline
├── db/pool.ts          # pg Pool (lazy) + Queryable adapter
├── services/
│   ├── structural.ts   # filter/sort/paginate + genres + stats
│   └── semantic.ts     # pgvector cosine similarity + hybrid
├── agent/
│   ├── runtime.ts      # Pi ModelRuntime singleton
│   ├── queryParser.ts  # NL query → structured HybridSearchRequest
│   └── chat.ts         # streaming catalog assistant with tool access
└── routes/
    ├── flicks.ts       # GET /flicks, /flicks/movie/:id, /flicks/filter
    ├── search.ts       # POST /search/structural|semantic|hybrid, GET genres/stats
    └── chat.ts         # POST /chat (SSE stream)
```

## Setup

```bash
docker compose up -d          # postgres+pgvector (:5433), redis (:6380) — healthchecked
cp .env.example .env          # adjust as needed (dev defaults work with compose)
npm install

# 1. schema     (npm run init:db   — pgvector extension + movies table)
# 2. ingest     (npm run ingest -- <file.csv>)
# 3. vectorize  (npm run embeddings)
# 4. run        (npm run dev  → http://localhost:8001)
```

No `.env` is required at boot — config ships dev defaults matching
`docker-compose.yml`.

| Script | Purpose |
|--------|---------|
| `npm run dev` | tsx watch server (:8001) |
| `npm run build` / `start` | compile + run dist |
| `npm test` / `typecheck` | vitest suite / tsc --noEmit |
| `npm run init:db` | pgvector extension + movies table (idempotent) |
| `npm run fetch:movies` | TMDB 1980→now (vote_count≥50), resume-safe upsert |
| `npm run ingest -- <csv>` | load movies CSV (quote-aware) |
| `npm run embeddings` | batch plot embeddings → plot_embedding |
| `npm run check` | env/catalog/agent health report |

## Agent mode

- `AGENT_ENABLED=true` (default): `POST /search/semantic` and `/search/hybrid`
  first run the query through a Pi agent that extracts filters/intent, then
  execute the search. `/chat` streams an assistant over SSE.
- Hybrid search relaxes categorical filters (genre/directors/stars) when the
  strict conjunction returns nothing, so users always get ranked results.
- The agent uses `~/.pi/agent/auth.json` credentials via `ModelRuntime`;
  `PI_MODEL` pins a specific model, and timeouts are configurable.
- **Status: live-verified end-to-end** — query parsing, tool-using chat,
  SSE streaming all confirmed against a seeded local catalog.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health |
| GET | `/flicks/` | Paginated movie list |
| GET | `/flicks/movie/:id` | Movie by id |
| GET | `/flicks/filter` | Filter by genre/directors/stars |
| POST | `/search/structural` | Filters, sort, pagination |
| POST | `/search/semantic` | NL plot search (agent-parsed) |
| POST | `/search/hybrid` | Filters + semantic ranking (agent-parsed) |
| GET | `/search/genres` | Genre facets |
| GET | `/search/stats` | Rating/runtime extents, count |
| POST | `/chat` | SSE agent chat `{ message, history? }` |

## Tests

```bash
npm test
```

## Migration notes (from Python backend)

- Removed: `main.py`, `src/` (Python), `tests/` (pytest), `ingestion/`,
  `pyproject.toml`, `uv.lock`, `pytest.ini`, `.python-version`.
- Endpoint parity kept: `/flicks`, `/flicks/movie/:id`, `/flicks/filter`,
  `/search/structural`, `/search/semantic`, `/search/hybrid`,
  `/search/genres`, `/search/stats`, `/`.
- Semantic threshold preserved (0.6); embedding model preserved
  (`all-MiniLM-L6-v2`, 384-dim); run `npm run embeddings` after migration to
  refresh vectors (library versions may differ slightly from
  sentence-transformers).
- Celery/Redis/flower deps dropped; Redis remains in compose for future use.