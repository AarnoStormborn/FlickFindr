import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SearchPage from './SearchPage';
import { searchMovies, getLanguages, semanticSearch } from '../api/movies';

/**
 * Guards the seam that broke twice: a filter is visible in the UI and present
 * in the URL, but the request sent to the API silently omits it because the
 * params object is built from an explicit allowlist.
 *
 * The first time this happened, the SearchPage requested an unfiltered search
 * with `lang=hi` in the address bar and happily rendered the unfiltered
 * results — a green test suite and a look at the URL both said it worked.
 */
vi.mock('../api/movies', () => ({
    searchMovies: vi.fn(),
    getLanguages: vi.fn(),
    semanticSearch: vi.fn(),
    hybridSearch: vi.fn(),
    // The page imports this constant; a mocked module has to re-export it or the
    // import resolves to undefined and every cap assertion silently changes.
    MAX_RESULTS: 100,
}));

const emptyPage = { results: [], total: 0, skip: 0, limit: 30, has_more: false };

function renderAt(url) {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <SearchPage />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    localStorage.clear();
    vi.mocked(searchMovies).mockReset().mockResolvedValue(emptyPage);
    vi.mocked(getLanguages).mockReset().mockResolvedValue([{ code: 'hi', count: 560 }]);
});

describe('SearchPage forwards URL filters to the API', () => {
    it('sends language when the URL carries lang', async () => {
        renderAt('/search?mode=structural&lang=hi');
        await waitFor(() => expect(searchMovies).toHaveBeenCalled());
        expect(searchMovies.mock.calls[0][0]).toMatchObject({ language: 'hi' });
    });

    it('does not send language when the URL has none', async () => {
        renderAt('/search?mode=structural&genre=Drama');
        await waitFor(() => expect(searchMovies).toHaveBeenCalled());
        const params = searchMovies.mock.calls[0][0];
        expect(params.genre).toBe('Drama');
        expect(params.language).toBeUndefined();
    });

    it('forwards language alongside the other filters, not instead of them', async () => {
        renderAt('/search?mode=structural&lang=fr&genre=Drama&min_rating=7');
        await waitFor(() => expect(searchMovies).toHaveBeenCalled());
        expect(searchMovies.mock.calls[0][0]).toMatchObject({
            language: 'fr',
            genre: 'Drama',
            minRating: 7,
        });
    });

    it('offers the language facet to the filter form', async () => {
        renderAt('/search?mode=structural');
        await waitFor(() => expect(getLanguages).toHaveBeenCalled());
        // The select is populated from the facet fetched by the page.
        await waitFor(() => expect(screen.getByLabelText(/language/i)).toBeInTheDocument());
    });
});

describe('SearchPage caps results at the top 100', () => {
    /** 20 movies per page, unique ids, as the API would return them. */
    const pageOf = (skip) =>
        Array.from({ length: 20 }, (_, i) => ({
            id: skip + i + 1,
            movie_name: `Movie ${skip + i + 1}`,
            original_language: 'en',
            release_year: 2000,
        }));

    beforeEach(() => {
        vi.mocked(searchMovies).mockImplementation(async (params = {}) => ({
            results: pageOf(params.skip ?? 0),
            total: 30749, // a search that matches the whole catalogue
            skip: params.skip ?? 0,
            limit: params.limit ?? 20,
            has_more: true, // the server would happily serve 30k
        }));
    });

    it('shows 20 on the first page, not 30', async () => {
        renderAt('/search?mode=structural&genre=Drama');
        await waitFor(() => expect(searchMovies).toHaveBeenCalled());
        await waitFor(() => expect(document.querySelectorAll('.movie-card')).toHaveLength(20));
        // The first page omits `skip` entirely (the API defaults it to 0).
        const first = searchMovies.mock.calls[0][0];
        expect(first.limit).toBe(20);
        expect(first.skip ?? 0).toBe(0);
    });

    it('reports the capped total rather than "30,749 matches"', async () => {
        renderAt('/search?mode=structural&genre=Drama');
        await waitFor(() => expect(screen.getByText(/top 100 of 30,749 matches/i)).toBeInTheDocument());
    });

    it('reports the real total when it is under the cap', async () => {
        vi.mocked(searchMovies).mockImplementation(async () => ({
            results: pageOf(0),
            total: 42,
            skip: 0,
            limit: 20,
            has_more: true,
        }));
        renderAt('/search?mode=structural&genre=Drama');
        await waitFor(() => expect(screen.getByText(/^42 matches$/)).toBeInTheDocument());
    });

    it('counts "more" against the cap, not the catalogue', async () => {
        renderAt('/search?mode=structural&genre=Drama');
        await waitFor(() => expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /show more/i })).toHaveTextContent('Show more (80 more)');
    });

    it('stops at 100 and never requests beyond the cap', async () => {
        const user = userEvent.setup();
        renderAt('/search?mode=structural&genre=Drama');
        await waitFor(() => expect(document.querySelectorAll('.movie-card')).toHaveLength(20));

        // Four more pages: 40, 60, 80, 100.
        for (let expected = 40; expected <= 100; expected += 20) {
            await user.click(screen.getByRole('button', { name: /show more/i }));
            await waitFor(() => expect(document.querySelectorAll('.movie-card')).toHaveLength(expected));
        }

        // The offer is gone, and no request ever reached past the window.
        expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
        for (const [params] of searchMovies.mock.calls) {
            expect((params.skip ?? 0) + (params.limit ?? 0)).toBeLessThanOrEqual(100);
        }
    });

    it('does not overshoot the cap on the final page', async () => {
        // A total just inside the cap: the last request must ask for the
        // remainder, not a full page past the end.
        vi.mocked(searchMovies).mockImplementation(async (params = {}) => {
            const skip = params.skip ?? 0;
            return {
                results: pageOf(skip).slice(0, Math.max(0, Math.min(20, 100 - skip))),
                total: 100,
                skip,
                limit: params.limit ?? 20,
                has_more: true,
            };
        });
        const user = userEvent.setup();
        renderAt('/search?mode=structural&genre=Drama');
        await waitFor(() => expect(document.querySelectorAll('.movie-card')).toHaveLength(20));

        await user.click(screen.getByRole('button', { name: /show more/i }));
        await waitFor(() => expect(document.querySelectorAll('.movie-card')).toHaveLength(40));
        // 100 - 40 = 60 remaining, so pages continue 20 at a time to exactly 100.
        expect(searchMovies.mock.calls.at(-1)[0]).toMatchObject({ limit: 20, skip: 20 });
    });
});

/**
 * Plot-based searches rank by embedding similarity, which is otherwise invisible.
 * The label is relative to the closest result on the page (similarities are not
 * comparable between queries), and the structural mode must stay untouched — it
 * has no similarity to explain.
 */
describe('SearchPage explains the plot ranking', () => {
    const semanticPage = {
        results: [
            { id: 1, movie_name: 'Titanic', rating: 7.9, similarity_score: 0.5 },
            { id: 2, movie_name: 'The Icebreaker', rating: 6.1, similarity_score: 0.41 },
            { id: 3, movie_name: 'Coherence', rating: 7.2, similarity_score: 0.3 },
        ],
        total: 3,
        skip: 0,
        limit: 20,
        has_more: false,
        exact_matches: false,
        message: 'No exact matches found, but here are some similar movies',
    };

    it('labels each result relative to the closest, and says how it ranked', async () => {
        vi.mocked(semanticSearch).mockReset().mockResolvedValue(semanticPage);
        renderAt('/search?mode=semantic&q=a+ship+hits+an+iceberg');

        await waitFor(() => expect(screen.getByText(/Ranked by how closely/)).toBeInTheDocument());
        const badges = [...document.querySelectorAll('.movie-card-match')].map((b) => b.textContent);
        expect(badges).toEqual(['Closest match', 'Related match', 'Loose match']); // 100%, 82%, 60%
        // The reason is on the badge itself, not only in prose above the grid.
        expect(document.querySelector('.movie-card-match')?.getAttribute('title')).toContain(
            'how closely the plot reads like your description',
        );
    });

    it('does not explain a ranking the structural mode does not use', async () => {
        renderAt('/search?mode=structural&genre=Drama');
        await waitFor(() => expect(searchMovies).toHaveBeenCalled());
        expect(screen.queryByText(/Ranked by how closely/)).toBeNull();
        expect(document.querySelectorAll('.movie-card-match')).toHaveLength(0);
    });
});
