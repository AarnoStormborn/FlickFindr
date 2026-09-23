import { describe, expect, it } from 'vitest';
import { formatMoney, formatRuntime } from './format';

describe('formatMoney', () => {
    it('shortens box office to millions and billions', () => {
        // The raw values are exact dollars from TMDB; Memento is 40060108 and
        // rendered as "$40060108" on the detail page before this existed.
        expect(formatMoney('40060108')).toBe('$40.1M');
        expect(formatMoney('2780000000')).toBe('$2.8B');
        expect(formatMoney(190304772)).toBe('$190.3M');
    });

    it('keeps small figures readable', () => {
        expect(formatMoney('156168')).toBe('$156.2K');
        expect(formatMoney('382291')).toBe('$382.3K');
        expect(formatMoney('950')).toBe('$950');
    });

    it('returns null when there is nothing to show', () => {
        // ~56% of the catalogue has no recorded revenue. An absent or 0 figure
        // must not become "$0" — the row is omitted instead.
        expect(formatMoney(null)).toBeNull();
        expect(formatMoney(undefined)).toBeNull();
        expect(formatMoney('')).toBeNull();
        expect(formatMoney('0')).toBeNull();
        expect(formatMoney(0)).toBeNull();
        expect(formatMoney('not a number')).toBeNull();
    });

    it('does not round a boundary value down to nothing', () => {
        expect(formatMoney('1000000')).toBe('$1M');
        expect(formatMoney('999999')).toBe('$1M');
    });
});

describe('formatRuntime', () => {
    it('formats hours and minutes', () => {
        expect(formatRuntime(89)).toBe('1h 29m');
        expect(formatRuntime(100)).toBe('1h 40m');
        expect(formatRuntime(45)).toBe('45m');
        expect(formatRuntime(60)).toBe('1h 0m');
    });

    it('returns null for a missing runtime', () => {
        expect(formatRuntime(null)).toBeNull();
        expect(formatRuntime(0)).toBeNull();
        expect(formatRuntime(undefined)).toBeNull();
    });
});
