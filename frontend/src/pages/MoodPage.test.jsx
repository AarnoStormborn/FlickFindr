import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MoodPage from './MoodPage';

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

function renderMood(id) {
    return render(
        <MemoryRouter initialEntries={[`/mood/${id}`]}>
            <Routes>
                <Route path="/mood/:id" element={<MoodPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

const film = (id, name) => ({ id, movie_name: name, rating: 8, release_year: 2000 });

describe('MoodPage', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('shows the mood name and caption and asks for that mood exactly', async () => {
        const calls = stubFetch([film(1, 'Memento')], 1);
        renderMood('mind-bending');

        await waitFor(() => expect(screen.getByText('Memento')).toBeInTheDocument());
        expect(screen.getByRole('heading', { name: 'Mind-Bending' })).toBeInTheDocument();
        expect(screen.getByText(/Twisty mysteries/)).toBeInTheDocument();
        // The page and the home row must use the same filters, or the row would
        // promise one set of films and the page deliver another.
        expect(calls[0].body).toMatchObject({ genre: 'Mystery', min_votes: 2000, min_rating: 7.2 });
    });

    it('sends the vote ceiling for Hidden Gems', async () => {
        const calls = stubFetch([film(1, 'Cinema Paradiso')], 1);
        renderMood('hidden-gems');
        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(calls[0].body).toMatchObject({ min_votes: 500, max_votes: 5000, min_rating: 7.5 });
        expect(calls[0].body.max_year).toBeLessThan(new Date().getFullYear());
    });

    it('uses Horror for Late-Night Thrills', async () => {
        const calls = stubFetch([film(1, 'The Shining')], 1);
        renderMood('late-night-thrills');
        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(calls[0].body.genre).toBe('Horror');
    });

    it('reports an unknown mood instead of rendering an empty page', async () => {
        stubFetch([], 0);
        renderMood('not-a-mood');
        expect(await screen.findByText('Unknown mood.')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /Mind-Bending/ })).toBeNull();
    });

    it('offers no Metascore sort, since the column is empty', async () => {
        stubFetch([film(1, 'Memento')], 1);
        renderMood('mind-bending');
        await waitFor(() => expect(screen.getByText('Memento')).toBeInTheDocument());
        const controls = document.querySelector('.genre-controls');
        expect(within(controls).getByRole('button', { name: /Rating/ })).toBeInTheDocument();
        expect(within(controls).queryByRole('button', { name: /Metascore/ })).toBeNull();
    });

    it('sorts by name when asked, re-requesting from the first page', async () => {
        const calls = stubFetch([film(1, 'Memento')], 1);
        renderMood('mind-bending');
        await waitFor(() => expect(screen.getByText('Memento')).toBeInTheDocument());
        await userEvent.click(screen.getByRole('button', { name: /Name/ }));
        await waitFor(() => expect(calls.some((c) => c.body?.sort_by === 'movie_name')).toBe(true));
    });
});
