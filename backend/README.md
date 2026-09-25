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
| `npm run backfill:languages` | fill `original_language` from TMDB (resumable; `-- --fill` for the per-movie remainder) |
| `npm run backfill:providers` | fill `watch_providers` (India + US) from TMDB; `-- --limit N` or `--all` |
| `npm run backfill:keywords` | fill `keywords` (TMDB keyword names, used for the second search vector); resumable, `-- --limit N` or `-- --concurrency N` |
| `npm run embeddings:remote` | embed for a remote DB in committed batches; `-- --all` to re-embed everything, `-- --from-id N` to resume |
| `npm run check` | env/catalog/agent health report |
| `npm run eval:relevance` | score describe-the-plot search against `scripts/relevance-queries.ts` (hits@10 + MRR + long-tail diagnostics); `-- --via-agent` to mirror the live LLM-rewrite path, `--json` for machine output |

### Relevance tuning

Plot search ranks by two cosines plus a prominence term:

```
plot similarity  +  SEMANTIC_KEYWORD_WEIGHT * keyword similarity  +  SEMANTIC_VOTE_WEIGHT * log-scaled votes
```

The two vectors exist because TMDB overviews withhold the premise (Titanic's never
says "iceberg"), so `keywords_embedding` holds `title + genres + keywords`. They are
kept as separate columns on purpose: blending them into one document was measured
and is a wash at best. Both weights are meant to be swept rather than guessed at:

```bash
cd backend
for w in 0 0.25 0.4 0.5 0.6 1.0; do
  echo -n "kw=$w  "; SEMANTIC_KEYWORD_WEIGHT=$w npm run eval:relevance | grep -E "hits@10|MRR" | tr '\n' ' '; echo
done
for w in 0.12 0.18 0.2 0.25; do
  echo -n "votes=$w  "; SEMANTIC_VOTE_WEIGHT=$w npm run eval:relevance | grep -E "hits@10|MRR" | tr '\n' ' '; echo
done
```

Changing *what* a vector contains means re-embedding: `npm run embeddings` locally
(~7 minutes for both columns) and `npm run embeddings:remote -- --all` for
production. Change `src/services/embeddingText.ts`, not the scripts — both
generators use it precisely so local and production cannot disagree about what a
vector means.

Sweep the two weights **together** — they interact, and tuning one at a time finds a
worse optimum. The eval set deliberately contains films with a few hundred votes
whose plots are unmistakable; they are the guard against a prior that is too strong,
and the reason the shipped vote weight is 0.18 rather than the 0.25 that scores
slightly better: at 0.2+ the 136-vote guard film falls to rank 10 and then out of its
own query altogether.

## Agent mode

- `AGENT_ENABLED=true` (default): `POST /search/semantic` and `/search/hybrid`
  first run the query through a Pi agent that extracts filters/intent, then
  execute the search. `/chat` streams an assistant over SSE (consumed by the
  frontend concierge at `/chat`).
- Hybrid search relaxes categorical filters (genre/directors/stars) when the
  strict conjunction returns nothing, so users always get ranked results.
- **Provider(s):** the bundled [`pi-agent/models.json`](pi-agent/models.json)
  declares Command Code (OpenAI-compatible at
  `https://api.commandcode.ai/provider/v1`). Groq, OpenRouter, DeepSeek,
  Cerebras and Google are Pi's native providers and need only their env key
  (`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`,
  `CEREBRAS_API_KEY`, `GEMINI_API_KEY`). Without any key the agent reports "not
  configured" and search falls back to the raw query.
- **Model choice is explicit, never accidental.** The agent resolves
  `PI_MODEL` → `AGENT_MODEL_FALLBACKS` (default: the cheapest reliable paid
  model first, then the free Groq/OpenRouter/Command Code tiers) → and only
  then the *cheapest* authenticated model. Provider catalogs mix free models
  with ~$50/M flagships, so the SDK's own "first available" default is not
  used. A run that returns no text retries with the next candidate, which is
  how an exhausted free tier degrades instead of breaking.
- `getAvailable()` validates credentials, **not** upstream health — a
  free model that is rate-limited upstream still gets selected and then fails,
  so the order favours models verified to work.
- Credentials are held in memory, not written to `auth.json`.
- `PI_MODELS_PATH` overrides the bundled config; timeouts and rate limits are
  configurable (`CHAT_TIMEOUT_MS`, `RATE_LIMIT_MAX`, `CHAT_RATE_LIMIT_MAX`).

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health |
| GET | `/flicks/` | Paginated movie list |
| GET | `/flicks/movie/:id` | Movie by id |
| GET | `/flicks/filter` | Filter by genre/directors/stars/language |
| POST | `/search/structural` | Filters, sort, pagination |
| POST | `/search/semantic` | NL plot search (agent-parsed) |
| POST | `/search/hybrid` | Filters + semantic ranking (agent-parsed) |
| GET | `/search/genres` | Genre facets |
| GET | `/search/languages` | Language facets (`{code, count}`, most common first) |
| GET | `/flicks/movie/:id/providers` | Where to watch (per-region Stream/Rent/Buy), cached in the DB |
| GET | `/search/stats` | Rating/runtime extents, count |

Pagination is capped at the **first 100 results** (`MAX_RESULTS`) for every
search mode: `limit` is at most 100, and a `skip` landing outside that window is
rejected with 400 rather than serving a 30k-deep page. The UI pages 20 at a time
and stops at 100.
| POST | `/chat` | SSE agent chat `{ message, history? }` |

## Tests

```bash
npm test              # fast, hermetic
npm run test:coverage # same run, against the threshold ratchet CI enforces
```

The suite runs **without** loading `backend/.env`: provider keys are skipped
when `NODE_ENV=test`, so no test can reach a live LLM API (that used to make CI
network-dependent, slow, quota-burning and intermittently timing out). Modules
that genuinely need a live Postgres or the embedding model (`src/db/pool.ts`,
`src/embedding.ts`) are excluded from the unit-coverage denominator and are
verified instead by `npm run check` and the deploy smoke tests.

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