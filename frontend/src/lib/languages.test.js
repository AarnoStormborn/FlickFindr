import { describe, expect, it } from 'vitest';
import { languageName, languageOptionLabel } from './languages';

/**
 * Language codes come from TMDB as ISO 639-1 ("en", "hi"). The catalogue holds
 * 88 of them, which is far too many to hand-maintain, so names come from
 * Intl.DisplayNames with a small fallback map.
 */
describe('languageName', () => {
    it('names the common codes', () => {
        expect(languageName('en')).toBe('English');
        expect(languageName('fr')).toBe('French');
        expect(languageName('hi')).toBe('Hindi');
        expect(languageName('ja')).toBe('Japanese');
    });

    it('is case-insensitive', () => {
        expect(languageName('FR')).toBe('French');
        expect(languageName(' fr ')).toBe('French');
    });

    it('returns null for nothing to name', () => {
        for (const input of [null, undefined, '', '   ', 42, {}]) {
            expect(languageName(input)).toBeNull();
        }
    });

    it('never returns Intl placeholder junk', () => {
        // Intl echoes the input for unknown codes and yields "und" for
        // undetermined; neither should reach the UI as if it were a name.
        for (const code of ['und', 'zz', 'qqq']) {
            const out = languageName(code);
            expect(out).toBeTruthy();
            expect(out).not.toBe(code); // uppercased fallback, not the raw code
            expect(out.toLowerCase()).not.toBe('und');
        }
    });

    it('falls back to the uppercased code rather than throwing', () => {
        expect(languageName('qqq')).toBe('QQQ');
    });
});

describe('languageOptionLabel', () => {
    it('appends a grouped count', () => {
        expect(languageOptionLabel({ code: 'en', count: 17856 })).toBe('English (17,856)');
    });

    it('omits the count when there is none', () => {
        expect(languageOptionLabel({ code: 'fr', count: 0 })).toBe('French');
        expect(languageOptionLabel({ code: 'fr' })).toBe('French');
    });

    it('survives a malformed entry', () => {
        expect(languageOptionLabel(undefined)).toBe('');
        expect(languageOptionLabel({})).toBe('');
    });
});
