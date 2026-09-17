import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MetadataForm from './MetadataForm';

/**
 * The language control is a <select>, not a text input like Genre: the API
 * filters on an exact TMDB code ("hi", "fr") and nobody should have to know
 * that. These tests pin the wiring: options come from the facet, the chosen
 * code reaches onSearch, and leaving it alone hides nothing.
 */

const LANGUAGES = [
    { code: 'en', count: 17856 },
    { code: 'fr', count: 2476 },
    { code: 'hi', count: 560 },
];

const submit = async (user) => {
    await user.click(screen.getByRole('button', { name: /search movies/i }));
};

describe('MetadataForm language filter', () => {
    it('offers every facet language plus an explicit no-filter option', () => {
        render(<MetadataForm languages={LANGUAGES} onSearch={() => {}} />);
        const select = screen.getByLabelText(/language/i);
        expect(select).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /any language/i })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /English \(17,856\)/i })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /Hindi \(560\)/i })).toBeInTheDocument();
    });

    it('emits the chosen code in the filter payload', async () => {
        const user = userEvent.setup();
        const onSearch = vi.fn();
        render(<MetadataForm languages={LANGUAGES} onSearch={onSearch} />);

        await user.selectOptions(screen.getByLabelText(/language/i), 'fr');
        await submit(user);

        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onSearch.mock.calls[0][0]).toMatchObject({ language: 'fr' });
    });

    it('omits language when left on Any language', async () => {
        const user = userEvent.setup();
        const onSearch = vi.fn();
        render(<MetadataForm languages={LANGUAGES} onSearch={onSearch} />);

        await submit(user);

        // The form follows the existing convention for optional fields
        // (`genre: genre || undefined`), so the key may exist but must be
        // falsy — the URL sync and the API client both drop falsy values, and
        // a truthy default here would silently filter every search.
        expect(onSearch.mock.calls[0][0].language).toBeUndefined();
    });

    it('preselects the language from the URL filters', () => {
        render(<MetadataForm languages={LANGUAGES} initial={{ language: 'hi' }} onSearch={() => {}} />);
        expect(screen.getByLabelText(/language/i)).toHaveValue('hi');
    });

    it('confirms the active choice in plain words', async () => {
        const user = userEvent.setup();
        render(<MetadataForm languages={LANGUAGES} onSearch={() => {}} />);
        expect(screen.queryByText(/only .* titles/i)).toBeNull();

        await user.selectOptions(screen.getByLabelText(/language/i), 'hi');
        expect(screen.getByText(/only hindi titles/i)).toBeInTheDocument();
    });

    it('still renders without a facet (fetch failed)', () => {
        render(<MetadataForm onSearch={() => {}} />);
        expect(screen.getByRole('option', { name: /any language/i })).toBeInTheDocument();
    });
});
