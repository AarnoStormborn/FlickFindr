# Runbook

Rebuilding or repairing a FlickFindr database, and verifying it afterwards.

The production database (Supabase) was assembled by hand, in stages: the
catalogue first, then trailers, then embeddings, then the language column and its
backfill. Each step landed after features already shipped, and nothing told you
when a database was only half-built — a missing column or a 0.4% coverage figure
surfaced as a feature quietly not working. This runbook and `npm run check` are
the fix for that.

Applies to the local Docker database and to production. Every command is
idempotent, and every step can be re-run.

## 0. Point at the database you mean

```bash
# Local (docker compose up -d postgres)
cd backend && npm run check

# Production (Supabase) — the connection string lives in the repo-root .env
cd backend && DATABASE_URL="$(grep -E '^DATABASE_URL=' ../.env | cut -d= -f2-)" npm run check
```

**Always confirm the target before writing.** `npm run check` prints the host it
reached; a backfill pointed at the wrong database writes tens of thousands of
rows into it.

## 1. Verify (do this first, and again at the end)

```bash
npm run check -- --strict     # exit 0 only if nothing is missing
```

`npm run check` reports reachability, catalogue size, per-area coverage and the
resolved agent model; `--strict` turns any warning into a non-zero exit, which is
what makes it usable as a gate. It is a pure function (`src/services/health.ts`)
with its own tests, so the rules are not folklore.

The current production shape, as a sanity reference:

| Area | Expected |
|---|---|
| Catalogue | ~30,749 films |
| Embeddings | **100%** — a film without one cannot be found by plot search |
| Language | **100%** — a film without one is hidden by every language filter |
| Trailer *checked* | **100%** — TMDB was asked |
| Trailer *present* | **~81%** — the rest genuinely have no trailer; not a defect |

That last distinction matters: `trailer_checked` is the completeness signal.
`withTrailer` is expected to sit below it, and the checker never complains about
it.

## 2. Schema

```bash
DATABASE_URL=... npm run init:db
```

Idempotent: creates the extension, the table, and every column and index via
`ADD COLUMN IF NOT EXISTS`. This is also the migration path for an older
database — `check` names any column it finds missing and points here.

## 3. Catalogue

Either load the archived parquet (the normal route):

```bash
python tools/load-backend/load.py          # reads DATABASE_URL
```

or fetch from TMDB directly (`npm run fetch:movies`, resumable per year), or
load a CSV (`npm run ingest -- <file.csv>`).

## 4. Embeddings

```bash
npm run embeddings           # local transformers.js (all-MiniLM-L6-v2, 384-dim)
npm run embeddings:remote    # or via the hosted endpoint
```

Batch job over rows with a NULL `plot_embedding`. Required for all catalogue
rows.

## 5. Language

```bash
npm run backfill:languages              # sweep
npm run backfill:languages -- --fill    # then the per-film remainder
```

- Pages TMDB `/discover` by release year. Each request returns 20 films and each
  already carries `original_language`, so the catalogue costs **~3.3k requests
  rather than ~31k** per-film lookups.
- **Resumable per year**, and the checkpoint file is namespaced by database host.
  Without that, a second target reads the first one's "all years complete" file,
  writes nothing, and reports success.
- `--fill` handles films the sweep cannot reach (TMDB no longer returns them
  under those filters) one request each. Expect a few thousand.

## 6. Trailers

Data is produced by `pi-ingest` (TMDB `/videos`, scored so sign-language
versions, Shorts and promo spots never win) and loaded with:

```bash
python tools/load-backend/load.py --trailers
```

The API also fetches a trailer **on demand** the first time a film's detail page
is opened, and caches it. A TMDB failure returns 503 and leaves
`trailer_checked=false` so it retries later — an outage must never be recorded as
a permanent "no trailer".

Refresh runs monthly on the Pi (`flickfindr-trailers.timer`); see
`pi-ingest/README.md`.

## 7. Where to watch (providers)

```bash
npm run backfill:providers                  # 1000 films (the default sample)
npm run backfill:providers -- --limit 5000
npm run backfill:providers -- --all         # whole catalogue
```

- **Per-film work**: one request each (`/movie/{id}/watch/providers`). Unlike
  language, there is no bulk route and `/discover` carries no provider data.
- That single request returns **all 112 regions**, so serving India and the US
  costs no more than serving one. `WATCH_REGIONS` (default `IN,US`) decides which
  are stored.
- Roughly **1.8s per film** from this network, so 1,000 takes ~30 minutes and the
  full catalogue is **~15 hours** single-threaded. Raise `--limit` when you want
  more, and consider adding concurrency before attempting `--all`.
- **No checkpoint file**: `providers_checked` on the row is the checkpoint, so it
  is resumable and safe to interrupt. Failed lookups stay unchecked and are
  retried on the next run; the job stops after 10 consecutive failures rather
  than grinding against an outage.
- The API also fetches on demand the first time a film's detail page is opened,
  so anything the backfill has not reached still works.

## 7. Deploy

- **Render** (API) and **Vercel** (frontend) — branch pins and the reason for
  them are in [`workflow.md`](workflow.md); a `dev` push must never reach
  production.
- Secrets live in the provider's env, never in the repo: `DATABASE_URL`,
  `CORS_ORIGINS`, and a model key (`DEEPSEEK_API_KEY`, `GROQ_API_KEY`,
  `COMMAND_CODE_API_KEY`, …).

## Known sharp edges

- **TMDB caps `/discover` at 500 pages** (10k results) per query, which is why
  every sweep segments by year rather than paging the whole catalogue.
- **There is no bulk-by-id endpoint.** `/movie/summaries` 404s on a v3 key, so
  per-film work (trailers, `--fill`) really is one request per film.
- **Search pagination is capped at the first 100 results** (`MAX_RESULTS` in
  `src/models.ts`); a `skip` beyond that is a 400 by design.
- **Runtime is now covered, and the gap is worth remembering.** Production had
  **0 of 30,749** runtimes: "Sort by Runtime" was sorting an empty column, card
  runtime badges never appeared, and an "under N minutes" filter matched nothing —
  with no warning anywhere, because cards simply omit a missing length. Now 30,700
  have a runtime and 30,748 are checked (TMDB has none for the last 47; they keep
  NULL and are marked checked, never 0, which would match an `under N minutes`
  filter). `npm run check --strict` reports no warnings against production.
  The 510 / 1.7% confusion earlier was the *dev* database: the tool read DB_* from
  `backend/.env`, found none, and defaulted to localhost. It now prefers
  `DATABASE_URL` — always pass it explicitly for production. Metascore is **not**
  recoverable (TMDB has no Metacritic data), so its badge and sort control were
  removed rather than left looking broken.
- **Re-running the runtime backfill** (new films, or a partial run):
  `cd tools/load-backend && DATABASE_URL=... .venv/bin/python backfill.py
  --concurrency 8`. It is resumable via `runtime_checked`, prints its target host,
  and aborts after 25 consecutive failures rather than grinding. Keep-alive
  session reuse is what makes it fast (13 films/s vs 1.1); a fresh handshake per
  request is what makes a lossy path look like a rate limit. If it ever reports
  nothing but failures, the signature is a *successful TLS handshake* followed by
  `Connection reset by peer` (`curl` code 000) with a 1472-byte ping dropped and
  1400 passing — an MTU black hole behind a tunnel, not a bad key. Run it from the
  Pi instead.
- **Mood rows are filters, not vibes.** Semantic mood queries do not work yet:
  the embedding model has no popularity prior, so plot-similar but obscure films
  outrank well-known ones ("a young wizard at a magic school" put two films with
  61 and 861 votes above Harry Potter). Define moods in `frontend/src/data/moods.js`
  with filters until Search relevance lands.
- **Ranked queries must break ties by `id`.** Without a tiebreaker, `OFFSET`
  paging on a tied sort repeats some rows and silently skips others.
- **Sorting by rating means the vote-weighted score, not the raw column**
  (`src/services/rating.ts`, m = 1000). Raw `rating` let ~100-vote films top every
  browse list. Expect `/flicks`, `/search/structural` and `/flicks/filter` to agree
  on the order, and results to carry `weighted_rating`. Raising `m` makes the
  ranking more mainstream, lowering it lets more obscure films rise; the value is
  kept equal to the frontend's `BEST_OF_MIN_VOTES`.
- **Do not add a keep-alive pinger for Render.** A 24/7 ping consumes ~744 of
  the 750 free instance-hours and exhausting it suspends every free service until
  the cycle resets; cold starts are covered in the UI instead.
- **Tests must not load `backend/.env`** (provider keys are skipped when
  `NODE_ENV=test`); otherwise the suite calls live LLM APIs.
