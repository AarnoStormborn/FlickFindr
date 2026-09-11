/**
 * Loading-quip copy pools. Kept in a separate module from the component so the
 * component file only exports a component (react-refresh friendly) and tests
 * can import the pools directly.
 *
 * NOTE: deliberately not named like the component (`LoadingQuips.jsx`) — on
 * case-insensitive filesystems (macOS) those two paths collide and module
 * resolution picks the wrong file.
 */

/** Tier 1 — quick, movie-flavoured, shown while a request is in flight. */
export const QUICK_QUIPS = [
  'Rolling the film…',
  'Warming up the projector…',
  'Threading the reel…',
  'Dimming the lights…',
  'Adjusting the tracking…',
  'Shushing the row behind you…',
  'Buying overpriced popcorn…',
  'Rendering the unskippable studio logos…',
  'Checking for a post-credits scene…',
  'Consulting the Criterion shelf…',
  'Sorting by vibes…',
  'Reticulating cinephiles…',
  'Fast-forwarding through the trailers…',
  'Confirming the book was better…',
  'Debating whether Die Hard is a Christmas movie…',
  'Arguing about the best Nolan film…',
];

/** Tier 2 — after ~6s it is a cold start, so be honest about it. */
export const SLOW_QUIPS = [
  'The server was napping. We’re poking it…',
  'Waking the projectionist…',
  'The server stepped out for a smoke break…',
  'Bribing the server with popcorn…',
  'It’s not buffering, it’s method acting…',
  'The server is booting like a 1997 DVD player…',
  'Negotiating with the cloud…',
  'Paging the ghost in the machine…',
  'Waiting for the audience to stop talking…',
  'Teaching the model to appreciate French New Wave…',
];
