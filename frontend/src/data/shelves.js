/**
 * Curated home shelves. Shared config between the home rows and the
 * "See more" era pages so the two never drift apart.
 *
 * `id` is also the route segment (/era/:id). `eraParams` supplies the
 * structural-search filters for the era browse page; the home rows build
 * their own 15-result query from the same window.
 */
const CURRENT_YEAR = new Date().getFullYear();

/** Vote floors so a handful of votes can't game the rating sort. */
export const BEST_OF_MIN_VOTES = 1000;
export const LATEST_MIN_VOTES = 300;

export const YEAR_SHELVES = [
    {
        id: 'latest',
        displayName: 'Latest Releases',
        caption: 'Fresh from the last two years',
    },
    {
        id: 'retro',
        displayName: 'Going Retro',
        caption: 'Totally rad picks from the 80s',
    },
    {
        id: 'millennium',
        displayName: 'The Millennium Classics',
        caption: 'The best of 2000–2009',
    },
];

export const GENRE_ROWS = [
    { id: 'drama', displayName: 'Top Drama', genres: ['Drama'], seeMoreGenre: 'Drama' },
    { id: 'action', displayName: 'Action & Adventure', genres: ['Action', 'Adventure'], seeMoreGenre: 'Action' },
    { id: 'comedy', displayName: 'Comedy', genres: ['Comedy'], seeMoreGenre: 'Comedy' },
    { id: 'scifi', displayName: 'Sci-Fi & Fantasy', genres: ['Science Fiction', 'Fantasy'], seeMoreGenre: 'Science Fiction' },
];

/** Structural-search filters for a shelf's full result set. */
export function eraParams(eraId) {
    switch (eraId) {
        case 'latest':
            return { minYear: CURRENT_YEAR - 2, maxYear: CURRENT_YEAR, minVotes: LATEST_MIN_VOTES };
        case 'retro':
            return { minYear: 1980, maxYear: 1989, minVotes: BEST_OF_MIN_VOTES };
        case 'millennium':
            return { minYear: 2000, maxYear: 2009, minVotes: BEST_OF_MIN_VOTES };
        default:
            return null;
    }
}

export function shelfById(id) {
    return YEAR_SHELVES.find((s) => s.id === id);
}