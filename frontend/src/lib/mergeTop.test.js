import { describe, expect, it } from 'vitest';
import { mergeTop } from './mergeTop';

/**
 * The home page merges several genre fetches into one row. It must rank by the
 * server's vote-weighted score: re-sorting by the raw rating here silently
 * undid the backend weighting and put a 143-vote 9.9 film on top of the row.
 */
const film = (id, rating, weighted_rating) => ({ id, rating, weighted_rating });

describe('mergeTop', () => {
    it('ranks by the weighted score, not the raw rating', () => {
        const obscure = film(1, 9.9, 6.36); // 143 votes
        const classic = film(2, 8.7, 8.63); // 31,232 votes
        const merged = mergeTop([{ results: [obscure] }, { results: [classic] }]);
        expect(merged.map((m) => m.id)).toEqual([2, 1]);
    });

    it('falls back to the raw rating when the score is absent', () => {
        const merged = mergeTop([{ results: [film(1, 6.1)] }, { results: [film(2, 7.4)] }]);
        expect(merged.map((m) => m.id)).toEqual([2, 1]);
    });

    it('dedupes by id, keeping the first occurrence', () => {
        const a = { id: 7, rating: 7, weighted_rating: 7, movie_name: 'from first' };
        const b = { id: 7, rating: 7, weighted_rating: 7, movie_name: 'from second' };
        const merged = mergeTop([{ results: [a] }, { results: [b] }]);
        expect(merged).toHaveLength(1);
        expect(merged[0].movie_name).toBe('from first');
    });

    it('caps the row at `top`', () => {
        const results = Array.from({ length: 20 }, (_, i) => film(i + 1, 8, 20 - i));
        expect(mergeTop([{ results }], 15)).toHaveLength(15);
    });

    it('tolerates missing results and scores', () => {
        expect(mergeTop([{}], 5)).toEqual([]);
        expect(mergeTop([{ results: [film(1, 8, null)] }])).toHaveLength(1);
    });
});
