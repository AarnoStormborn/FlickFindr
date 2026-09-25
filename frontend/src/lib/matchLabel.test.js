import { describe, expect, it } from 'vitest';
import { matchLabel } from './matchLabel';

/**
 * The label is the only place a user is told why a plot-search result is where it
 * is, so it has to be honest about being relative — and must not leak a raw cosine
 * as if it were a confidence score.
 */
describe('matchLabel', () => {
    it('marks the best result as the closest', () => {
        expect(matchLabel(0.51, 0.51).text).toBe('Closest match');
    });

    it('grades the rest relative to the closest result', () => {
        expect(matchLabel(0.485, 0.51).text).toBe('Strong match'); // 95%
        expect(matchLabel(0.44, 0.51).text).toBe('Related match'); // 86%
        expect(matchLabel(0.30, 0.51).text).toBe('Loose match'); // 59%
    });

    it('never presents the raw similarity as a score', () => {
        const { title } = matchLabel(0.44, 0.51);
        expect(title).toContain('86% of the closest result on this page');
        // 0.44 must not appear as "44% match" anywhere: that reads as a failure.
        expect(title).not.toContain('44%');
    });

    it('degrades gracefully without a usable score', () => {
        expect(matchLabel(null, 0.5)).toBeNull();
        expect(matchLabel(undefined, 0.5)).toBeNull();
        expect(matchLabel(NaN, 0.5)).toBeNull();
        // No usable top score: still say why the result is here, without a ratio.
        expect(matchLabel(0.4, 0).text).toBe('Plot match');
        expect(matchLabel(0.4, 0).title).not.toContain('% of the closest');
    });
});
