/**
 * Mood and occasion rows.
 *
 * These are not genres — they cut across them. Each mood is a saved structural
 * search, so a row is deterministic, instant to load, and explainable: every
 * mood below can be described in one sentence of filters, which is also what its
 * "See more" page uses.
 *
 * Every definition here was tuned against the catalogue and the resulting films
 * were read back before shipping. That mattered: a mood row whose contents don't
 * match its name is worse than no row.
 *
 * Note on the semantic path: `Mind-Bending` was originally intended as a
 * semantic query ("a film that bends reality"), and that was tried first. It
 * does not work yet — the embedding model has no popularity prior, so "a young
 * wizard at a magic school" ranks two films with 61 and 861 votes above Harry
 * Potter (30,141). Moods that want a *vibe* need the search-relevance work.
 * Until then they are expressed as filters, which the data supports well.
 */
const CURRENT_YEAR = new Date().getFullYear();

/** A rating from a few hundred votes is still a small sample, hence the floors. */
export const MOODS = [
    {
        id: 'mind-bending',
        displayName: 'Mind-Bending',
        caption: 'Twisty mysteries that rewire your brain',
        // Genre-led rather than semantic (see the note above). Mystery at a high
        // vote floor reads as twist/reality films: Se7en, Shutter Island, The
        // Prestige, Memento, Oldboy, Donnie Darko, Mulholland Drive, Arrival.
        // The floor is 2,000 rather than 5,000 to give "See more" something to
        // show (23 films vs 69) — the top of the row is identical either way.
        filters: { genre: 'Mystery', minVotes: 2000, minRating: 7.2 },
    },
    {
        id: 'late-night-thrills',
        displayName: 'Late-Night Thrills',
        caption: 'Dread and darkness for after dark',
        // Horror rather than Thriller: a Thriller filter returned the same films
        // as the top-rated row (The Dark Knight, Pulp Fiction, Parasite), so the
        // row would have been a duplicate. Horror is a genuinely distinct set:
        // The Shining, The Thing, Train to Busan, Get Out.
        filters: { genre: 'Horror', minVotes: 1000 },
    },
    {
        id: 'hidden-gems',
        displayName: 'Hidden Gems',
        caption: 'Loved and well rated, but nowhere near the top of the list',
        // The vote *ceiling* is the whole point: without it this is just the
        // top-rated list again. The year cap matters too — recent releases carry
        // unsettled ratings, and without it every raw-rating test surfaced 2026
        // titles with a few thousand votes at 8.7+.
        filters: {
            minRating: 7.5,
            minVotes: 500,
            maxVotes: 5000,
            maxYear: CURRENT_YEAR - 2,
        },
    },
];

export function moodById(id) {
    return MOODS.find((m) => m.id === id);
}

/**
 * Structural-search request for a mood's full result set. Returns null for an
 * unknown id so callers can render their not-found state.
 */
export function moodParams(id) {
    return moodById(id)?.filters ?? null;
}
