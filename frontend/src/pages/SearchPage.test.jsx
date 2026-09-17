import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SearchPage from './SearchPage';
import { searchMovies, getLanguages } from '../api/movies';

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
