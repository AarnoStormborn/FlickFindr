# Frontend Feature Ideas

A running list of future UI features (not yet implemented). Add ideas here so
they survive across sessions. Keep each entry short: what + where + why.

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

### Table stakes we still need (support the picker, not the wedge)

- Trailers, where-to-watch, reviews — IMDb/TMDB have all three; a picker often
  wants them. Build them, but never mistake them for differentiation.

### Honest constraints

- We are a curated subset (~31k films, 1980+, 50+ votes); they have ~10M
  titles. Do not fight them on breadth — that is their game.
- Ratings/votes are TMDB's. Semantic search via embeddings is commodity tech —
  it only becomes a moat as a *polished, conversational experience*.

### How this anchors feature decisions

- **Lean in:** chat assistant, describe-the-plot search, More Like This,
  Surprise Me, mood shelves — decision shortcuts databases don't bother with.
- **Support:** trailers + where-to-watch + history/lists — needed, but generic.
- Prioritise work that makes the **agent the product**: a concierge that can
  search, reason about taste, and converse inside a beautiful picker UI.

---

## 1. Search history for users

Let users look back at what they searched.

- Store recent searches (query/mode + filters, timestamp) — localStorage or a
  backend endpoint.
- Show a "Recent searches" list on the Search page (re-run on click, clear
  history action).
- Ideally per-user (implies accounts later); until then, per-browser is fine.

## 2. Movie lists ("create a list and add movies")

Let users curate their own lists (e.g. "Watch later", "Favorites", custom).

- Create / rename / delete lists.
- Add a movie to a list from:
  - the movie detail page (button / dropdown),
  - a small dropdown menu on grid cards and list-view rows.
- Lists page to view a list (grid/list toggle) and remove entries.
- Persistence: localStorage first (no accounts yet); shape the data so it can
  move to a backend + user table later.

## Backlog (feature ideas, not yet scoped)

### Trailers
- TMDB `/movie/{id}/videos` (free, existing key) → YouTube keys.
- Play button on cards + detail page; lightbox embed. Highest-impact picker feature.

### Where to watch
- TMDB `/watch/providers` per region → Netflix/Prime/etc.
- Show availability on the detail page; filter/annotate results.

### More like this
- We already have 30k+ plot embeddings — nearest-neighbour on the detail page.
- Feels magical to non-tech users (“if you liked Inception…”).

### Surprise me
- One button → a random highly-rated film; optional constraint (genre / under 2h).

### Mood & occasion collections
- Editorial shelves a non-tech person relates to: Date Night, Rainy Sunday,
  Need a Laugh, Under 100 min, Oscar Winners.
- Cheap: saved structural searches with pretty titles.

### Explainable semantic results
- For describe-the-plot searches, show *why* each result matched (matched plot
  snippet + similarity) — builds trust in the differentiator.

### Positioning note for lists
- Lists should start with a one-tap **Watch later** (the default list); custom
  lists come second.

---
