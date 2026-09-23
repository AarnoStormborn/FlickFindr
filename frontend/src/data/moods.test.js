import { describe, expect, it } from 'vitest';
import { MOODS, moodById, moodParams } from './moods';

/**
 * Mood rows are only worth having if their contents match their names, so these
 * pin the properties that make each definition mean something. The specific
 * filters were tuned by reading the resulting films back from the catalogue.
 */
describe('mood definitions', () => {
    it('has unique ids and the display fields the UI needs', () => {
        const ids = MOODS.map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const mood of MOODS) {
            expect(mood.displayName, mood.id).toBeTruthy();
            expect(mood.caption, mood.id).toBeTruthy();
            expect(Object.keys(mood.filters).length, mood.id).toBeGreaterThan(0);
        }
    });

    it('only uses filter keys the API actually forwards', () => {
        // A typo here fails silently: searchMovies simply omits unknown keys, so
        // the row would quietly become "everything" rather than erroring.
        const supported = new Set([
            'query', 'genre', 'directors', 'stars', 'language',
            'minRating', 'maxRating', 'minRuntime', 'maxRuntime',
            'minYear', 'maxYear', 'minVotes', 'maxVotes',
        ]);
        for (const mood of MOODS) {
            for (const key of Object.keys(mood.filters)) {
                expect(supported.has(key), `${mood.id}.${key}`).toBe(true);
            }
        }
    });

    it('gives Hidden Gems a vote ceiling and a recency cap', () => {
        // Without the ceiling this is the top-rated list again — the whole point
        // is to exclude the films that dominate every other row. Without the year
        // cap, unsettled ratings on brand-new releases sweep the row (every raw
        // test surfaced 2026 titles at 8.7+ with a few thousand votes).
        const gems = moodById('hidden-gems');
        expect(gems.filters.maxVotes).toBeGreaterThan(gems.filters.minVotes);
        expect(gems.filters.maxYear).toBeLessThan(new Date().getFullYear());
    });

    it('floors its moods above the noise band', () => {
        // Every mood needs enough votes behind its rating to mean something.
        for (const mood of MOODS) {
            expect(mood.filters.minVotes ?? 0, mood.id).toBeGreaterThanOrEqual(500);
        }
    });

    it('resolves params by id and returns null when unknown', () => {
        expect(moodParams('late-night-thrills')).toEqual(moodById('late-night-thrills').filters);
        expect(moodParams('nope')).toBeNull();
        expect(moodById('nope')).toBeUndefined();
    });
});
