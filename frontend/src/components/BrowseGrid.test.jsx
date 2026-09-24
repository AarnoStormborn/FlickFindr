import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BrowseGrid from './BrowseGrid';

/**
 * BrowseGrid carries the fetch/sort/paginate logic for the genre, era and mood
 * pages, so its behaviour is asserted once here rather than three times.
 *
 * Two gotchas this file has to respect:
 *  - MovieCard navigates, so everything renders inside a Router.
 *  - searchMovies memoises by request body in a module-level cache, so each test
 *    uses a distinct filter value; otherwise a later test silently reuses an
 *    earlier test's cached response and never reaches the fetch stub.
 */

function stubFetch(rows = [], total = 0) {
    const calls = [];
    globalThis.fetch = vi.fn((url, init) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
        return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ results: rows, total, skip: 0, limit: 20, has_more: false }),
        });
    });
    return calls;
}

function renderGrid(ui) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const film = (id, name) => ({ id, movie_name: name, rating: 8, release_year: 2000 });

describe('BrowseGrid', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the title, the total and the cards', async () => {
        stubFetch([film(1, 'Memento'), film(2, 'Se7en')], 2);
        renderGrid(<BrowseGrid filters={{ genre: 'Mystery' }} title="Mind-Bending" subtitle="Twisty" />);
        await waitFor(() => expect(screen.getByText('Memento')).toBeInTheDocument());
        expect(screen.getByText('Mind-Bending')).toBeInTheDocument();
        expect(screen.getByText(/Twisty · 2 movies/)).toBeInTheDocument();
        expect(screen.getByText('Se7en')).toBeInTheDocument();
    });

    it('sends the filters and the default sort', async () => {
        const calls = stubFetch([film(1, 'Memento')], 1);
        renderGrid(<BrowseGrid filters={{ genre: 'Documentary', minVotes: 5000 }} title="Docs" />);
        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(calls[0].body).toMatchObject({
            genre: 'Documentary',
            min_votes: 5000,
            sort_by: 'rating',
            sort_order: 'desc',
            skip: 0,
            limit: 20,
        });
    });

    it('does not refetch when handed an equal-but-new filters object', async () => {
        // Callers build filters inline, so every render passes a fresh object.
        // Keying the effect on identity would loop forever; keying it on the
        // value means one request.
        const calls = stubFetch([film(1, 'Memento')], 1);
        const { rerender } = renderGrid(<BrowseGrid filters={{ genre: 'Western' }} title="A" />);
        await waitFor(() => expect(calls.length).toBe(1));
        rerender(
            <MemoryRouter>
                <BrowseGrid filters={{ genre: 'Western' }} title="A" />
            </MemoryRouter>,
        );
        await new Promise((r) => setTimeout(r, 20));
        expect(calls.length).toBe(1);
    });

    it('refetches when the filters actually change', async () => {
        const calls = stubFetch([film(1, 'Memento')], 1);
        const { rerender } = renderGrid(<BrowseGrid filters={{ genre: 'Animation' }} title="A" />);
        await waitFor(() => expect(calls.length).toBe(1));
        rerender(
            <MemoryRouter>
                <BrowseGrid filters={{ genre: 'Family' }} title="A" />
            </MemoryRouter>,
        );
        await waitFor(() => expect(calls.length).toBe(2));
        expect(calls[1].body.genre).toBe('Family');
    });

    it('offers only the sorts it is given, and no Metascore by default', async () => {
        stubFetch([film(1, 'Memento')], 1);
        renderGrid(
            <BrowseGrid
                filters={{ genre: 'Music' }}
                title="A"
                sortOptions={[
                    { value: 'rating', label: 'Rating' },
                    { value: 'movie_name', label: 'Name' },
                ]}
            />,
        );
        await waitFor(() => expect(screen.getByText('Memento')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /Rating/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Name/ })).toBeInTheDocument();
        // The metascore column is empty for every film, so that sort is gone.
        expect(screen.queryByRole('button', { name: /Metascore/ })).toBeNull();
    });

    it('shows the empty message rather than an empty grid', async () => {
        stubFetch([], 0);
        renderGrid(<BrowseGrid filters={{ language: 'sv' }} title="Top in Swedish" emptyText="No films recorded in Swedish." />);
        await waitFor(() => expect(screen.getByText('No films recorded in Swedish.')).toBeInTheDocument());
        expect(document.querySelector('.movies-grid')).toBeNull();
    });

    it('surfaces a failed fetch', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'boom' }) }));
        renderGrid(<BrowseGrid filters={{ genre: 'War' }} title="A" />);
        await waitFor(() => expect(screen.getByText('Failed to load movies')).toBeInTheDocument());
    });

    it('paginates when there are more results than a page', async () => {
        stubFetch([film(1, 'Memento')], 45);
        renderGrid(<BrowseGrid filters={{ genre: 'History' }} title="A" />);
        await waitFor(() => expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled();
    });

    it('never pages past the server cap, and says so', async () => {
        // Reported from the home page: "See more" on any row failed from page 5
        // onwards. The API rejects a skip beyond MAX_RESULTS (100) with a 400,
        // but the page count was computed from the uncapped total, so a genre
        // with 13,540 films offered 677 pages of which 672 could only fail.
        const calls = stubFetch([film(1, 'Memento')], 13540);
        renderGrid(<BrowseGrid filters={{ genre: 'Drama' }} title="Drama Movies" />);

        // 100 reachable results at 20 per page is five pages, not 677.
        await waitFor(() => expect(screen.getByText(/Page 1 of 5/)).toBeInTheDocument());
        // The count is honest about the window rather than implying 13,540.
        expect(screen.getByText(/Top 100 of 13,540 movies/)).toBeInTheDocument();

        // Walk to the last page; Next must disable rather than request page 6.
        for (let i = 0; i < 4; i += 1) {
            await userEvent.click(screen.getByRole('button', { name: /Next/ }));
            await waitFor(() => expect(screen.getByText(new RegExp(`Page ${i + 2} of 5`))).toBeInTheDocument());
        }
        expect(screen.getByText(/Page 5 of 5/)).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled());

        // The regression itself: every request must stay inside the window.
        const skips = calls.map((c) => c.body.skip).filter((s) => s !== undefined);
        expect(skips).toEqual([0, 20, 40, 60, 80]);
        expect(skips.every((s) => s <= 99)).toBe(true);
    });

    it('shows the plain count when everything fits in the window', async () => {
        stubFetch([film(1, 'Memento')], 45);
        renderGrid(<BrowseGrid filters={{ genre: 'Film-Noir' }} title="A" countLabel="movies found" />);
        await waitFor(() => expect(screen.getByText(/45 movies found/)).toBeInTheDocument());
        expect(screen.queryByText(/Top 100 of/)).toBeNull();
    });
});
