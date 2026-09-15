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
| **Playful loading quips** | `frontend/src/components/LoadingQuips.jsx` | Two tiers; escalates at 6s to acknowledge Render cold starts |
| **Concierge chat UI** | `frontend/src/pages/ChatPage.jsx`, `frontend/src/api/chat.js` | Streaming SSE chat at `/chat`; the agent curates its picks into movie cards |
| **Infra** | `docs/workflow.md`, `deploy/`, `.github/workflows/` | feature → dev → main, main guard, path-aware CI/deploys, trailer timer |
| **Tests** | `backend/tests`, `frontend/src/**/*.test.*` | 98 backend + 104 frontend; coverage thresholds ratcheted in CI; `npm audit` clean in both packages |

---

## Next up

### Where to watch
- TMDB `/watch/providers` per region → Netflix/Prime/etc. on the detail page.
- Reuse the proven **trailer playbook**: Pi fetches → S3 parquet → DB load, so
  there's zero request-time TMDB dependency. Needs a provider-refresh timer
  alongside the existing trailer one.

### Surprise me
- One button → a random highly-rated film; optional constraint (genre, under 2h).
- Cheap: one endpoint over the existing structural search + a button in the hero.

### Mood & occasion collections
- Editorial shelves a non-tech person relates to: Date Night, Rainy Sunday,
  Need a Laugh, Under 100 min, Oscar Winners.
- Cheap: saved structural searches with pretty titles — extends `data/shelves.js`.

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
- **Still open:** no provider key is set on Render, so production reports
  "The concierge isn't configured on this server yet." Add one of
  `DEEPSEEK_API_KEY` / `GROQ_API_KEY` / `COMMAND_CODE_API_KEY` to the service
  env to switch it on.
- **Measured limits of free tiers:** a turn costs several model calls, so
  per-minute token caps dominate — Groq free measured 36-165s per turn at
  ~60% success, and Command Code's free models cap at ~100 requests/day. This
  is why a cheap paid model is the sensible primary. Chat timeout is 240s
  because slower providers were being aborted mid-loop, which looked like an
  empty reply.
- Free models also ignore "reply in plain prose" instructions, so the UI
  renders light markdown itself (`RichText`) rather than trusting the model.

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
