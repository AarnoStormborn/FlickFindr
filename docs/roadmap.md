# FlickFindr Roadmap

Status of planned work. Keep entries short: what + where + why. Update the
status when something ships so this stays the source of truth for "what next".

---

## Positioning — what makes FlickFindr different

> FlickFindr isn't a movie database — it's a movie picker. You don't browse it
> like IMDb; you ask it like a friend who's seen everything.

**IMDb and TMDB answer “tell me about *that* movie.” FlickFindr answers
“what should I watch *next*?”** They are noun-first encyclopedias built for
completeness; we are a decision-first concierge for a non-tech person on a couch.

### The genuine wedge (defensible)

- **Plot-language search** — type *"a quiet movie about two strangers who slowly
  become friends"* and get thematically right answers. IMDb does literal
  keyword matching; TMDB doesn't attempt this. No mainstream site has it.
- **A conversational concierge** — the Pi-SDK agent interprets intent and chats
  with the catalog. Neither IMDb nor TMDB ships anything like this. This is the
  reason the agent stack exists — lean in hard.

### Table stakes (support the picker, not the wedge)

- Where-to-watch, reviews. IMDb/TMDB have them; a picker often wants them.
  Build them, but never mistake them for differentiation.

### Honest constraints

- We are a curated subset (~31k films, 1980+, 50+ votes); they have ~10M
  titles. Do not fight them on breadth — that is their game.
- Ratings/votes are TMDB's. Semantic search via embeddings is commodity tech —
  it only becomes a moat as a *polished, conversational experience*.

### How this anchors feature decisions

- **Lean in:** chat assistant, describe-the-plot search, More Like This,
  Surprise Me, mood shelves — decision shortcuts databases don't bother with.
- **Support:** where-to-watch + history/lists — needed, but generic.
- Prioritise work that makes the **agent the product**: a concierge that can
  search, reason about taste, and converse inside a beautiful picker UI.

---

## Shipped

| Feature | Where | Notes |
|---|---|---|
| **Plot / hybrid / structural search** | `backend/src/services/`, `/search` | pgvector cosine similarity + agent query parsing; "Show more" pagination (30/page) |
| **Agent query parsing** | `backend/src/agent/queryParser.ts` | NL query → structured filters; per-query cache; graceful fallback |
| **Search history** | `frontend/src/hooks/useSearchHistory.js` | Local-first (localStorage), chips on the search page, re-run + clear |
| **Movie lists** | `frontend/src/lib/listsStore.js`, `/lists` | Watch later + custom lists; save from detail page, grid cards and list rows |
| **Trailers** | `pi-ingest/ingest/trailers.py`, detail page | Stored in the DB (not request-time TMDB); 25,096 movies; monthly Pi refresh; candidate scoring rejects sign-language versions / Shorts / promo spots |
| **More Like This** | `/flicks/movie/:id/similar`, detail page | Genre-aware embedding neighbours, in a carousel with arrows |
| **Discovery shelves** | `frontend/src/data/shelves.js` | Latest / Going Retro / Millennium + curated genre rows, with vote floors |
| **Cinematic redesign** | `frontend/src/index.css` (tokens) · `docs/FRONTEND_DESIGN_INSPIRATION.md` (rationale) | Dark editorial palette, Bodoni Moda / Inter, floating nav. The CSS custom properties are the source of truth — the design doc predates the build and its sample hexes differ |
| **Mood shelves** | `frontend/src/data/moods.js`, `frontend/src/pages/MoodPage.jsx` | Short & Sweet / Mind-Bending / Late-Night Thrills / Hidden Gems rows on the home page, each with a See-more page sharing the same filters. Tuned against the catalogue — see the roadmap for the definitions that were changed and why |
| **Runtime coverage** | `tools/load-backend/backfill.py`, `backend/src/services/health.ts` | 30,700 of 30,749 films now have a runtime (was **0**); TMDB has none for the remaining 47, which are marked checked rather than written as 0. Unblocked the Runtime sort, card runtime badges and Short & Sweet. The drift detector now reports runtime coverage |
| **Home language browse** | `frontend/src/pages/MoviesPage.jsx` | A language selector that swaps the shelves for a ranked "Top in <language>" browse, carried in the URL. A mode switch rather than filtering each row, since most of the 88 languages are too small to fill a shelf |
| **Shared browse grid** | `frontend/src/components/BrowseGrid.jsx` | Genre, era and mood pages were three copies of the same fetch/sort/paginate body; now one component. Also the single place that drops the unusable Metascore sort |
| **Vote-weighted ranking** | `backend/src/services/rating.ts` | Ranking by raw `rating` put films with ~100 votes at the top of every browse list, ahead of films with tens of thousands. Sorting by rating now uses a Bayesian score — `(v/(v+m))·rating + (m/(v+m))·mean`, m = 1000 — applied everywhere rating is the sort key (browse, filter, search, agent, and the provider backfill). Nothing is hidden: a low-vote film is still returned, just placed by evidence rather than by a small sample |
| **Where to watch** | `backend/scripts/backfill-providers.ts`, `frontend/src/components/WhereToWatch.jsx` | TMDB/JustWatch providers per region (India + US, switchable); Stream/Rent/Buy on the detail page; on-demand fetch + cache, with a 1,000-film sample backfilled so far |
| **Language filter** | `backend/scripts/backfill-languages.ts`, `frontend/src/lib/languages.js` | `original_language` for 30,749/30,749 films (88 languages) from a segmented TMDB `/discover` sweep (~3.3k requests, not ~31k per-movie lookups); filter on search + filter form, and the agent honours "only French films" |
| **Playful loading quips** | `frontend/src/components/LoadingQuips.jsx` | Two tiers; escalates at 6s to acknowledge Render cold starts |
| **Concierge chat UI** | `frontend/src/pages/ChatPage.jsx`, `frontend/src/api/chat.js` | Streaming SSE chat at `/chat`; the agent curates its picks into movie cards |
| **Infra** | `docs/workflow.md`, `deploy/`, `.github/workflows/` | feature → dev → main, main guard, path-aware CI/deploys, trailer timer |
| **Tests** | `backend/tests`, `frontend/src/**/*.test.*` | 98 backend + 104 frontend; coverage thresholds ratcheted in CI; `npm audit` clean in both packages |

---

## Next up

### Mood & occasion collections — *shipped*
- Mood rows on the home page, each cutting across genres: **Short & Sweet**
  (under 100 minutes and well rated), **Mind-Bending** (twisty mysteries),
  **Late-Night Thrills** (horror), **Hidden Gems** (well rated, under 5,000
  votes). Each has a "See more" page driven by the same filters, so a row and
  its page cannot disagree.
- Every definition was tuned against the catalogue and the films read back
  before shipping. Three corrections came out of that: a Thriller filter returned
  the same films as the top-rated row (so Late-Night Thrills uses Horror), Hidden
  Gems needed a vote *ceiling* plus a recency cap (without them it was either the
  top-rated list again or a list of 2026 releases with unsettled ratings), and
  Short & Sweet had to wait for the runtime backfill below — it would have drawn
  on 12 films.
- **The semantic path does not work for moods yet.** `Mind-Bending` was meant to
  be a semantic query ("a film that bends reality") and was tried first: the
  embedding model has no popularity prior, so "a young wizard at a magic school"
  ranks two films with 61 and 861 votes above Harry Potter (30,141). Moods that
  want a *vibe* need Search relevance before they can use it; until then they are
  filters, which the data supports well.

### Home language browse — *shipped*
- A language selector on the home page: choosing one replaces the shelves with a
  ranked "Top in <language>" browse, carried in the URL (`?lang=hi`) so it is
  shareable and survives a reload. Clear restores the shelves.
- Deliberately a mode switch rather than filtering every row: most of the 88
  languages are small (Swedish is 143 films), so scoped rows would return empty,
  and an empty shelf is worse than none.

### Runtime backfill — *done*
- **Production had zero runtimes** when this started: 0 of 30,749. The 510 / 1.7%
  figure that first looked like "mostly fine" was the *local* database — the tool
  read DB_* from `backend/.env`, found none, and silently defaulted to localhost,
  so an earlier run filled the dev database and production was never touched.
- **Now 30,700 films have a runtime and 30,748 have been checked** (the rest are
  films TMDB has no runtime for, recorded as checked with runtime NULL rather than
  a 0 that would match an "under N minutes" filter). `npm run check --strict`
  reports no warnings against production.
- Fixed the things this was blocking: "Sort by Runtime" sorts real data, card
  runtime badges appear (production had never shown one), and **Short & Sweet**
  could be built — its pool went from 12 films to 1,628.
- Throughput was 1.1 films/s until the client was made to reuse TLS connections;
  13.3 films/s afterwards, for the whole catalogue in 37 minutes.
- **Host matters.** TMDB is only partly reachable from the dev Mac: ~50% of
  requests fail with *a successful TLS handshake followed by a reset*. A 1472-byte
  probe is dropped while 1400 passes — an MTU black hole behind a tunnel, not a
  bad key. Keep-alive mostly neutralises it, but the Pi's connectivity is proven
  and is the better host for scheduled work.
- **Not recoverable: `metascore`.** TMDB carries no Metacritic score, so the
  badge and its sort control were removed rather than left to look broken.
  Sourcing it would mean a different provider.

### Surprise me
- One button → a random highly-rated film; optional constraint (genre, under 2h).
- Cheap: one endpoint over the existing structural search + a button in the hero.

### Explainable semantic results
- For describe-the-plot searches, show *why* each result matched (matched plot
  snippet + similarity) — builds trust in the differentiator.

### Conversational concierge (the wedge) — *shipped*
- `POST /chat` (SSE) streams the agent's reply **and the movies it found**,
  which render as clickable cards; frontend page at `/chat` ("Concierge" in the
  nav). The transcript persists in localStorage across navigation and reloads.
- The agent curates what's displayed via a `show_movies` tool, so cards match
  its recommendations instead of raw search noise, and the UI reveals the cards
  only after the text finishes streaming.
- Model choice is explicit across providers — DeepSeek → Groq → OpenRouter free
  → Command Code → cheapest authenticated — never the SDK's "first available"
  (a 69-model catalog mixes in ~$50/M flagships). A run that returns no text
  retries with the next candidate, so an exhausted free tier degrades instead
  of breaking.
- **Live in production:** provider keys are set on Render and DeepSeek is
  funded. Verified end-to-end from the Vercel origin: 17s cold-start turn, 5
  curated cards, no errors. Measured on DeepSeek once warm: 7-9s per turn,
  always on attempt 0 (no fallback retries), ~$0.003-0.01 per turn.
- **Spend exposure:** the only guard is the per-IP rate limit (8 chat turns/min).
  There is no global daily cap, so a determined abuser on many IPs could drain
  the provider balance. Balance is currently small, which is its own limit.
- **Measured limits of free tiers:** a turn costs several model calls, so
  per-minute token caps dominate — Groq free measured 36-165s per turn at
  ~60% success, and Command Code's free models cap at ~100 requests/day. This
  is why a cheap paid model is the sensible primary. Chat timeout is 240s
  because slower providers were being aborted mid-loop, which looked like an
  empty reply.
- Free models also ignore "reply in plain prose" instructions, so the UI
  renders light markdown itself (`RichText`) rather than trusting the model.

### Language filtering
- A viewer asked why they could not exclude films they cannot understand: the
  catalogue mixed world cinema into every list. The data did not exist — the
  ingest only ever passed TMDB `language=en-US` as a *response* locale, so plots
  came back in English while the film's own language was never stored.
- Backfilled from TMDB by paging `/discover` per release year (20 films per
  request, each already carrying `original_language`) rather than 30,749
  per-movie lookups: ~3.3k requests, resumable per year.
- **Language is a hard filter.** Hybrid search relaxes genre/directors/stars
  when the strict conjunction is empty, and language deliberately sits outside
  that: relaxing it would hand back the exact films the viewer excluded.

### Search relevance — *ranking fixed; retrieval is the remaining gap*
- Plot search ranked on cosine similarity **alone**, so a plot that literally
  restated the query beat the famous film it described: a 61-vote film outranked
  Harry Potter (30,141 votes), and a 243-vote film outranked The Martian.
- Ranking now adds a bounded, log-scaled prominence term (`SEMANTIC_VOTE_WEIGHT`,
  default 0.12). Measured with a committed eval set (`npm run eval:relevance`,
  38 queries, hits@10 + MRR):

  | | unweighted | weighted |
  |---|---|---|
  | raw query | 15/38 (39.5%), MRR 0.230 | **21/38 (55.3%), MRR 0.332** |
  | via the LLM rewrite (the live path) | 14/38 (36.8%), MRR 0.190 | **20/38 (52.6%), MRR 0.294** |

  Six queries gained and none lost on both paths. The weight sits where the gain
  stops being free: a 237-vote film a precise query describes holds its unweighted
  rank 7th at 0.12, slips to 9th at 0.2, and leaves the top ten at 0.25. Two other
  long-tail guards are too obscure for the retriever at *every* weight, so they are
  recorded as known misses rather than blamed on the prior.
- **The LLM rewrite is now tuned; the remaining failures are the source text.**
  `/search/semantic` embeds the agent's rewrite rather than the user's words. The
  prompt used to demand a *theme* — "query must be short (5-15 words) and capture
  the plot/theme intent, e.g. 'prison escape and friendship'" — which stripped
  exactly the words that make a film findable: "a suicidal woman is saved on a
  **Paris bridge** by a knife thrower" became "suicidal woman saved by knife
  thrower". Rewriting now has to keep concrete detail and expand references
  instead of abstracting:

  | | hits@10 (43 queries) | MRR | rewrites identical to input |
  |---|---|---|---|
  | old prompt | 20/43 (46.5%) | 0.276 | 6/38 |
  | **new prompt** | **23/43 (53.5%)** | 0.301 | 30/38 |
  | no rewrite at all | 22/43 (51.2%) | 0.301 | — |

  It also recovered the 237-vote guard film, which the old prompt pushed out of the
  top ten at *every* weight. The eval set gained a colloquial section to test
  whether the agent earns its latency: on indirect references it does — "the
  spinning top dream movie" now finds Inception, which raw embedding cannot.
- **Retrieval: a second vector for keywords — *shipped*.** The embedded document
  was TMDB's overview alone, which withholds the premise by design, so some queries
  could not retrieve the right film *at any weight or with any model*: The Sixth
  Sense's overview never says the boy sees dead people, Titanic's never says
  "iceberg". A keywords backfill (30,712 films, 22 minutes, 26,130 with keywords)
  now feeds a second vector, `keywords_embedding`, built from
  `title + genres + keywords`, and ranking adds its cosine with a weight of 0.5.
  Ranking the catalogue by each vector separately showed how complementary they
  are — the target's rank for "that film about the ship hitting an iceberg":
  **370th by the plot vector, 13th by the keyword vector**.
- **Two failed attempts are recorded because they look reasonable and are not.**
  Merging keywords *into* the plot document measured as a wash (22/43 hits, six
  queries gained and six lost) — the keyword bag displaced the plot. "Fixing" that
  by putting the plot first and capping keywords was worse still (18/43). Keeping
  the vectors apart is what works: the plot term is untouched, so plot-driven
  queries cannot regress, and the keyword term only adds. A trim of the plot text's
  trailing punctuation was also measured and reverted (21/43 vs 22/43) — retrieval
  here is brittle enough that tidying is a regression.
- **Measured result** (43-query eval set, same vectors, only the keyword weight
  varying): 0 → 22/43 (51.2%) / MRR 0.265, 0.25 → 24/43, 0.4 → 24/43 / 0.297,
  **0.5 → 25/43 (58.1%) / MRR 0.298**, 0.6 → 26/43 / 0.296, 1.0 → 24/43.
  At 0.5 three queries are gained and none lost, including the iceberg query that
  previously could not be answered at all. Once the keyword vector existed the two
  weights were swept **together** (they interact): `keyword 0.5 / votes 0.18` gives
  **26/43 (60.5%) and MRR 0.349**, against 25/43 and 0.298 at the old vote weight.
  Higher vote weights score marginally better on the aggregate — 0.20 → 27/43, 0.25
  → 27/43 with MRR 0.382 — but the aggregate is dominated by queries naming
  well-known films, and at 0.20 the fixture's 136-vote guard film sits at rank 10,
  one position from dropping out of its own query. The lower weight keeps a real
  margin on long-tail retrieval, which is the reason those films are in the fixture.
- **The embedding model: measured, and deferred on evidence.** MiniLM was compared
  against `bge-small-en-v1.5` (the strongest 384-dim alternative) on the ranking that
  the keyword vector exists to fix. Each model was used with its own correct pooling
  (MiniLM mean, BGE CLS — using the wrong one measures the mistake, not the model),
  and MiniLM ranked the target film **first** where BGE put it **second**, behind a
  decoy. BGE's similarities also sit much higher across the board, which would
  invalidate both tuned weights (keyword and prominence) and mean re-tuning them
  from scratch. With the remaining failures being *text* gaps rather than model gaps
  — The Sixth Sense's keywords do not contain "sees dead people" either — a swap is
  not the next win. The configuration is now explicit
  (`EMBEDDING_MODEL`, `EMBEDDING_QUERY_PREFIX`, `EMBEDDING_PASSAGE_PREFIX`,
  `EMBEDDING_POOLING`) so a future candidate is a measurement rather than a rewrite.
  The dimension must stay 384 or both columns need a schema change.
- **Explainable plot results — *shipped*.** Plot search showed no reason for its
  ordering. Each result now carries a plain-language label ("Closest match", "Strong
  match", "Related match", "Loose match") and the results header states the rule:
  ranked by how closely the plot matches, then by how well known the film is. The
  raw cosine is deliberately **not** shown as a percentage — a good MiniLM plot
  match scores ~0.4-0.5, so "45%" would read as a failure — and the label is
  expressed relative to the closest result on the page and says so, because
  embedding similarities are not comparable between queries.
- **Where the remaining misses come from — diagnosed, not guessed.** Ranking each
  failing target by each vector separately shows three distinct causes, and only one
  of them is the model:

  | film | plot rank | keyword rank | combined | cause |
  |---|---|---|---|---|
  | Titanic | 370 | 5 | 5 | keyword vector working as intended |
  | Primer | 1173 | 23 | 108 | **a linear sum dilutes a strong single-vector match** |
  | The Red Virgin | 669 | 5821 | 921 | **junk keywords (two generic terms) make it worse than plot alone** |
  | The Sixth Sense | 1794 | 58 | 64 | vocabulary is present (`ghost`, `ghost child`, `afterlife`) — a model limit |
  | Man from Snowy River | 93 | 14 | 17 | near-miss; no single cause |
  | Highlander | 6 | 529 | 8 | plot alone would be 6th; the vote weight costs it |

  So the next lever is **fusion, not more data**: reciprocal-rank fusion (or per-query
  normalisation of the two cosines) fixes dilution and stops a weak keyword list from
  costing anything, because a film ranked 23rd by keywords keeps that signal however
  badly it ranks by plot. The catch is that RRF scores are ~0.01-0.02 rather than
  ~0.5, so the prominence weight has to be re-derived, and it needs a second sort of
  the catalogue per query — a real latency cost on a free tier. Worth doing, but it
  is a measured project rather than a tweak, and the harness is what makes it one.

- Also still worth doing: showing *why* a result matched (matched plot snippet +
  similarity), which builds trust in the differentiator.

---

## Backlog / nice-to-haves

- **Reviews** — third-party ratings/reviews on the detail page (table stakes).
- **Accounts + cloud sync** — move lists/history from localStorage to per-user
  storage once multi-device use matters (the concierge transcript would move
  with it).
- **Watchlist notifications** — tell me when a saved film lands on a service.
- **Coverage raise** — thresholds now sit a few points under the measured
  baseline; lift them as the untested pages/components (`SearchPage`,
  `MetadataForm`, `MovieListTable`) get covered.

---

## Deferred / decided against

- **Keep-alive pinger for Render** — a 24/7 pinger consumes ~744 of the 750
  free instance hours per 31-day month (~6h margin); exhausting it suspends
  *all* free services until the 1st. The loading quips solve the same UX
  problem with zero server traffic. See `docs/workflow.md`.
- **Full catalogue breadth** — deliberately curated (~31k, 1980+, 50+ votes).
