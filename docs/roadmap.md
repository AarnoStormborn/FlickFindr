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
| **Mood shelves** | `frontend/src/data/moods.js`, `frontend/src/pages/MoodPage.jsx` | Mind-Bending / Late-Night Thrills / Hidden Gems rows on the home page, each with a See-more page sharing the same filters. Tuned against the catalogue — see the roadmap for the two definitions that were changed and why |
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

### Mood & occasion collections — *shipped (3 of 4)*
- Mood rows on the home page, each cutting across genres: **Mind-Bending**
  (twisty mysteries), **Late-Night Thrills** (horror), **Hidden Gems** (well
  rated, under 5,000 votes). Each has a "See more" page driven by the same
  filters, so the row and the page cannot disagree.
- Every definition was tuned against the catalogue and the films read back
  before shipping. Two corrections came out of that: a Thriller filter returned
  the same films as the top-rated row (so Late-Night Thrills uses Horror), and
  Hidden Gems needed a vote *ceiling* plus a recency cap — without them it was
  the top-rated list again, or a list of 2026 releases with unsettled ratings.
- **`Short & Sweet` (under 100 min) is not shippable yet** — see the runtime
  note below.
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

### Runtime & revenue backfill — **blocked work, data gap**
- `runtime` is populated for **510 of 30,749 films (1.7%)** and `metascore` for
  **none**, both verified in production. Consequences: the existing "Sort by
  Runtime" control ranks almost nothing, the runtime badge on cards is absent,
  and `Short & Sweet` cannot be built.
- Recoverable: `tools/load-backend/backfill.py` fills runtime + gross from TMDB
  one film at a time (~30k calls, resumable, `--concurrency`). Same shape as the
  trailer/provider work, so it belongs on the Pi ingest schedule.
- **Not recoverable: `metascore`.** TMDB carries no Metacritic score, so the
  badge and its sort control were dead UI and have been removed rather than left
  to look broken. Sourcing it would mean a different provider.

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

### Search relevance
- Plot-language search (semantic/hybrid) returns thematically loose results for
  some queries — the embedding model is small (MiniLM) and the catalogue is
  curated. Candidates: reranking, a stronger embedding model, or leaning on the
  agent to filter before display (as `show_movies` now does).

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
