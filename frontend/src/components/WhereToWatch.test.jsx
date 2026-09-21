import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WhereToWatch from './WhereToWatch';
import { getWatchProviders } from '../api/movies';

/**
 * "Where to watch" is additive: it must never break the detail page. Two
 * behaviours matter most — a failed lookup renders nothing rather than an
 * error, and a stale response for a previously-viewed film never renders.
 */
vi.mock('../api/movies', () => ({ getWatchProviders: vi.fn() }));

const payload = (regions) => ({
    regions,
    attribution: { text: 'Watch provider data provided by JustWatch', url: 'https://www.justwatch.com' },
});

const INDIA = {
    code: 'IN',
    link: 'https://www.themoviedb.org/movie/1/watch?locale=IN',
    flatrate: [{ id: 8, name: 'Amazon Prime Video', logo: 'https://img/prime.png' }],
    rent: [{ id: 2, name: 'Apple TV Store', logo: null }],
    buy: [],
};
const US = {
    code: 'US',
    link: 'https://www.themoviedb.org/movie/1/watch?locale=US',
    flatrate: [{ id: 9, name: 'ViX', logo: null }],
    rent: [],
    buy: [],
};

beforeEach(() => {
    localStorage.clear();
    vi.mocked(getWatchProviders).mockReset();
});

describe('WhereToWatch', () => {
    it('groups offers into Stream / Rent / Buy', async () => {
        vi.mocked(getWatchProviders).mockResolvedValue(payload([INDIA]));
        render(<WhereToWatch movieId={1} />);

        expect(await screen.findByText('Amazon Prime Video')).toBeInTheDocument();
        expect(screen.getByText('Stream')).toBeInTheDocument();
        expect(screen.getByText('Apple TV Store')).toBeInTheDocument();
        expect(screen.getByText('Rent')).toBeInTheDocument();
        // No buy offers for this film, so no empty "Buy" heading.
        expect(screen.queryByText('Buy')).toBeNull();
    });

    it('renders provider logos with empty alt text (decorative)', async () => {
        vi.mocked(getWatchProviders).mockResolvedValue(payload([INDIA]));
        const { container } = render(<WhereToWatch movieId={1} />);
        await screen.findByText('Amazon Prime Video');
        const img = container.querySelector('.where-to-watch-logo');
        expect(img).toHaveAttribute('src', 'https://img/prime.png');
        expect(img).toHaveAttribute('alt', '');
    });

    it('attributes the data to JustWatch, opening safely', async () => {
        vi.mocked(getWatchProviders).mockResolvedValue(payload([INDIA]));
        render(<WhereToWatch movieId={1} />);
        const link = await screen.findByRole('link', { name: /justwatch/i });
        expect(link).toHaveAttribute('href', INDIA.link);
        expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });

    it('defaults to India and switches region, remembering the choice', async () => {
        vi.mocked(getWatchProviders).mockResolvedValue(payload([INDIA, US]));
        const user = userEvent.setup();
        render(<WhereToWatch movieId={1} />);

        // Default region is IN, so its providers show first.
        expect(await screen.findByText('Amazon Prime Video')).toBeInTheDocument();
        expect(screen.queryByText('ViX')).toBeNull();

        await user.click(screen.getByRole('button', { name: /united states/i }));

        expect(screen.getByText('ViX')).toBeInTheDocument();
        expect(screen.queryByText('Amazon Prime Video')).toBeNull();
        expect(localStorage.getItem('flickfindr-watch-region')).toBe('US');
    });

    it('shows no region switcher when only one region has data', async () => {
        vi.mocked(getWatchProviders).mockResolvedValue(payload([INDIA]));
        render(<WhereToWatch movieId={1} />);
        await screen.findByText('Amazon Prime Video');
        expect(screen.queryByRole('group', { name: /region/i })).toBeNull();
    });

    it('falls back to a returned region when the remembered one has no data', async () => {
        localStorage.setItem('flickfindr-watch-region', 'GB');
        vi.mocked(getWatchProviders).mockResolvedValue(payload([US]));
        render(<WhereToWatch movieId={1} />);
        expect(await screen.findByText('ViX')).toBeInTheDocument();
    });

    it('says plainly when nothing is available, rather than showing an empty shell', async () => {
        vi.mocked(getWatchProviders).mockResolvedValue(payload([]));
        render(<WhereToWatch movieId={1} />);
        expect(await screen.findByText(/not on any streaming service we track in india/i)).toBeInTheDocument();
    });

    it('renders nothing at all when the lookup fails', async () => {
        vi.mocked(getWatchProviders).mockRejectedValue(new Error('nope'));
        const { container } = render(<WhereToWatch movieId={1} />);
        await waitFor(() => expect(vi.mocked(getWatchProviders)).toHaveBeenCalled());
        expect(container).toBeEmptyDOMElement();
    });

    it('never renders a stale response after the movie changes', async () => {
        let resolveFirst;
        vi.mocked(getWatchProviders)
            .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
            .mockResolvedValue(payload([US]));

        const { rerender } = render(<WhereToWatch movieId={1} />);
        rerender(<WhereToWatch movieId={2} />);

        // The slow response for movie 1 arrives after movie 2 is on screen.
        resolveFirst(payload([INDIA]));

        expect(await screen.findByText('ViX')).toBeInTheDocument();
        expect(screen.queryByText('Amazon Prime Video')).toBeNull();
    });
});
