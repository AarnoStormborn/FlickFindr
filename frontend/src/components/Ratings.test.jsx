import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Ratings from './Ratings';

/**
 * Third-party ratings are additive: they must render when the data is there and stay
 * completely invisible otherwise. An empty ratings strip, or an error about a
 * third-party provider, would be noise on every film that has no scores.
 */
const SAMPLE = {
    imdb_id: 'tt0111161',
    imdb: { score: 9.3, votes: 2800000 },
    rotten_tomatoes: { score: 91 },
    metacritic: { score: 82 },
    source: 'OMDb',
};

function stub(payload, ok = true) {
    vi.stubGlobal(
        'fetch',
        vi.fn(() =>
            Promise.resolve({ ok, status: ok ? 200 : 503, json: () => Promise.resolve(payload) }),
        ),
    );
}

const renderRatings = () =>
    render(
        <MemoryRouter>
            <Ratings movieId={278} />
        </MemoryRouter>,
    );

describe('Ratings', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('shows all three sources with their scores', async () => {
        stub({ ratings: SAMPLE, attribution: { text: 'via OMDb' } });
        renderRatings();
        await waitFor(() => expect(screen.getByText('9.3')).toBeInTheDocument());
        expect(screen.getByText('91%')).toBeInTheDocument();
        expect(screen.getByText('82')).toBeInTheDocument();
        expect(screen.getByText('IMDb')).toBeInTheDocument();
    });

    it('links out to the film on IMDb', async () => {
        stub({ ratings: SAMPLE });
        renderRatings();
        const link = await screen.findByRole('link', { name: /imdb/i });
        expect(link).toHaveAttribute('href', 'https://www.imdb.com/title/tt0111161/');
        // A new tab must not get a handle on our window.
        expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
    });

    it('shows only the sources that exist', async () => {
        stub({ ratings: { ...SAMPLE, rotten_tomatoes: null, metacritic: null } });
        renderRatings();
        await waitFor(() => expect(screen.getByText('9.3')).toBeInTheDocument());
        expect(screen.queryByText('RT')).toBeNull();
        expect(screen.queryByText('MC')).toBeNull();
    });

    it('renders nothing when the film has no ratings', async () => {
        stub({ ratings: null, attribution: { text: 'via OMDb' } });
        const { container } = renderRatings();
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
        expect(container.querySelector('.ratings')).toBeNull();
    });

    it('renders nothing when the lookup fails (e.g. no key configured)', async () => {
        stub({ detail: 'Third-party ratings are not configured on this server' }, false);
        const { container } = renderRatings();
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
        expect(container.querySelector('.ratings')).toBeNull();
    });

    it("never renders a stale film's scores", async () => {
        // The payload is tagged with the movie it belongs to, so switching films
        // cannot flash the previous film's scores.
        stub({ ratings: SAMPLE });
        const { rerender } = render(
            <MemoryRouter>
                <Ratings movieId={278} />
            </MemoryRouter>,
        );
        await waitFor(() => expect(screen.getByText('9.3')).toBeInTheDocument());
        rerender(
            <MemoryRouter>
                <Ratings movieId={999} />
            </MemoryRouter>,
        );
        expect(screen.queryByText('9.3')).toBeNull();
    });
});
