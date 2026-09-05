# Frontend Feature Ideas

A running list of future UI features (not yet implemented). Add ideas here so
they survive across sessions. Keep each entry short: what + where + why.

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

---

## Backlog (older notes, not yet scoped)

- _Reserved for future ideas — append below this line with a short title and
  2–4 bullet points._
