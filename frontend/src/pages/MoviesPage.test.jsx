import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * The home language control. Choosing a language swaps the shelves for a browse
 * of that language and records the choice in the URL; Clear restores the shelves.
 *
 * Rendered through <App> because the page needs a Router and the lists context.
 */
function routeFetch() {
    return vi.fn((url, init) => {
        const href = String(url);
        const body = init?.body ? JSON.parse(init.body) : null;
        if (href.includes('/search/languages')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve([
                    { code: 'en', count: 19191 },
                    { code: 'hi', count: 599 },
                ]),
            });
        }
        if (href.includes('/search/structural')) {
            const rows = body?.language
                ? [{ id: 99, movie_name: 'Dilwale Dulhania Le Jayenge', rating: 8.5, release_year: 1995 }]
                : [{ id: 1, movie_name: 'Inception', rating: 8.4, release_year: 2010 }];
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ results: rows, total: rows.length, skip: 0, limit: 20, has_more: false }),
            });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [], total: 0 }) });
    });
}

function renderHome(search = '') {
    window.history.pushState({}, '', `/${search}`);
    return render(<App />);
}

describe('home language filter', () => {
    beforeEach(() => {
        globalThis.fetch = routeFetch();
    });

    it('starts neutral, showing the shelves and every language as an option', async () => {
        renderHome();
        const select = await screen.findByLabelText(/Language/i);
        expect(select.value).toBe('');
        expect(screen.getByRole('option', { name: 'All languages' })).toBeInTheDocument();
        // Options carry their catalogue size so the choice is informed.
        await waitFor(() => expect(screen.getByRole('option', { name: 'Hindi (599)' })).toBeInTheDocument());
        // Shelves are the default view.
        await waitFor(() => expect(document.querySelector('.category-row')).toBeTruthy());
    });

    it('swaps the shelves for a browse of the chosen language and records it in the URL', async () => {
        renderHome();
        const select = await screen.findByLabelText(/Language/i);
        await userEvent.selectOptions(select, 'hi');

        await waitFor(() => expect(screen.getByRole('heading', { name: /Top in Hindi/ })).toBeInTheDocument());
        expect(window.location.search).toContain('lang=hi');
        // The shelves are replaced, not filtered: no empty rows can appear.
        expect(document.querySelector('.category-row')).toBeNull();
        await waitFor(() => expect(screen.getByText('Dilwale Dulhania Le Jayenge')).toBeInTheDocument());
    });

    it('renders the choice straight from the URL, so it is shareable', async () => {
        renderHome('?lang=hi');
        await waitFor(() => expect(screen.getByRole('heading', { name: /Top in Hindi/ })).toBeInTheDocument());
        expect(screen.getByText('Dilwale Dulhania Le Jayenge')).toBeInTheDocument();
    });

    it('restores the shelves when cleared', async () => {
        renderHome('?lang=hi');
        await waitFor(() => expect(screen.getByRole('heading', { name: /Top in Hindi/ })).toBeInTheDocument());

        await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
        await waitFor(() => expect(window.location.search).not.toContain('lang='));
        await waitFor(() => expect(document.querySelector('.category-row')).toBeTruthy());
    });

    it('offers no Clear button while no language is chosen', async () => {
        renderHome();
        await screen.findByLabelText(/Language/i);
        expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    });
});
