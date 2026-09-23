/**
 * Vote-weighted ("Bayesian") rating — the ordering key used wherever films are
 * ranked by rating.
 *
 * Ranking by raw `rating` alone let a film with 66 votes and a 9.1 average sit
 * above films with tens of thousands of votes, so the top of every browse list
 * was obscure titles:
 *
 *   The Way to the Heart     143 votes   9.9
 *   Endless Journey of Love   66 votes   9.1
 *   ...above...
 *   The Shawshank Redemption 31,232 votes 8.7
 *
 * The weighted score shrinks a film's own rating toward the catalogue average in
 * proportion to how little evidence supports it:
 *
 *   score = (v / (v + m)) * rating + (m / (v + m)) * mean(rating)
 *
 * With m = 1000 a film needs around a thousand votes before its own rating
 * outweighs the prior — at 66 votes it keeps only 6% of its own rating, so it
 * can no longer outrank a classic. Nothing is hidden: a low-vote film is still
 * returned and still reachable, it simply has to earn its position rather than
 * being handed the top by a small sample.
 *
 * The same m as the home shelves' BEST_OF_MIN_VOTES (frontend/src/data/shelves.js)
 * keeps the floor and the ordering agreeing about what "well established" means.
 */
export const RATING_PRIOR_WEIGHT = 1000;

/**
 * `votes` is stored as text, so it is cast for arithmetic. A missing or empty
 * count means "no evidence": the film is scored at the prior mean rather than
 * being floated to the top by a high rating nobody has voted on.
 */
const VOTES = "COALESCE(NULLIF(votes, '')::numeric, 0)";

/**
 * The mean is read from the table rather than hardcoded so the ranking keeps
 * tracking the catalogue as the monthly ingest changes it (~6.3 today). It is
 * uncorrelated, so Postgres evaluates it once per query rather than per row.
 * Everything is cast to numeric so the arithmetic has one unambiguous type.
 */
const PRIOR_MEAN = "(SELECT avg(rating)::numeric FROM movies WHERE rating IS NOT NULL)";

/** The weighted score as a SQL expression, to be used in an ORDER BY (or SELECT). */
export const WEIGHTED_RATING_SQL =
  `((${VOTES} / (${VOTES} + ${RATING_PRIOR_WEIGHT})) * rating::numeric` +
  ` + (${RATING_PRIOR_WEIGHT} / (${VOTES} + ${RATING_PRIOR_WEIGHT})) * ${PRIOR_MEAN})`;
