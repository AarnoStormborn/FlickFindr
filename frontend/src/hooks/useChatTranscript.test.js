import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useChatTranscript, { loadTranscript } from './useChatTranscript';

const KEY = 'flickfindr-concierge-transcript';

const movie = (id = 1, name = 'Alien') => ({
    id,
    movie_name: name,
    release_year: 1979,
    rating: 8.5,
    runtime: 117,
    genre: 'Horror',
    poster_url: 'https://example.com/a.jpg',
});

beforeEach(() => {
    localStorage.clear();
});

describe('useChatTranscript', () => {
    it('starts empty when nothing is stored', () => {
        const { result } = renderHook(() => useChatTranscript());
        expect(result.current.messages).toEqual([]);
    });

    it('persists messages so they survive a remount (navigation/reload)', () => {
        const first = renderHook(() => useChatTranscript());
        act(() => {
            first.result.current.update([
                { role: 'user', content: 'a heist movie' },
                { role: 'assistant', content: 'Try these.', movies: [movie()] },
            ]);
        });
        first.unmount();

        // A fresh mount, as a route change or reload would do.
        const second = renderHook(() => useChatTranscript());
        expect(second.result.current.messages).toHaveLength(2);
        expect(second.result.current.messages[1].content).toBe('Try these.');
        expect(second.result.current.messages[1].movies[0].movie_name).toBe('Alien');
    });

    it('accepts an updater function like setState', () => {
        const { result } = renderHook(() => useChatTranscript());
        act(() => result.current.update([{ role: 'user', content: 'one' }]));
        act(() => result.current.update((prev) => [...prev, { role: 'assistant', content: 'two' }]));
        expect(result.current.messages.map((m) => m.content)).toEqual(['one', 'two']);
    });

    it('clears the transcript and the stored copy', () => {
        const { result } = renderHook(() => useChatTranscript());
        act(() => result.current.update([{ role: 'user', content: 'one' }]));
        act(() => result.current.clear());
        expect(result.current.messages).toEqual([]);
        expect(localStorage.getItem(KEY)).toBe('[]');
    });

    it('caps stored messages so it cannot grow without bound', () => {
        const { result } = renderHook(() => useChatTranscript());
        const many = Array.from({ length: 100 }, (_, i) => ({ role: 'user', content: `m${i}` }));
        act(() => result.current.update(many));
        expect(result.current.messages).toHaveLength(40);
        // Keeps the most recent, not the oldest.
        expect(result.current.messages.at(-1).content).toBe('m99');
    });

    it('ignores corrupt stored data', () => {
        localStorage.setItem(KEY, 'not json{');
        expect(loadTranscript()).toEqual([]);
        localStorage.setItem(KEY, JSON.stringify({ nope: true }));
        expect(loadTranscript()).toEqual([]);
    });

    it('drops malformed messages and movies', () => {
        localStorage.setItem(
            KEY,
            JSON.stringify([
                { role: 'user', content: 'ok' },
                { role: 'narrator', content: 'bad role' },
                { role: 'assistant' },
                null,
                { role: 'assistant', content: 'picks', movies: [{ nope: 1 }, movie(7, 'Primer')] },
            ]),
        );
        const loaded = loadTranscript();
        expect(loaded.map((m) => m.content)).toEqual(['ok', 'picks']);
        expect(loaded[1].movies).toHaveLength(1);
        expect(loaded[1].movies[0].movie_name).toBe('Primer');
    });

    it('does not restore a trailing empty assistant bubble', () => {
        // What an interrupted stream leaves behind.
        localStorage.setItem(
            KEY,
            JSON.stringify([
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: '', movies: [] },
            ]),
        );
        expect(loadTranscript()).toEqual([{ role: 'user', content: 'hi', movies: [] }]);
    });

    it('keeps an assistant message that has cards but no text', () => {
        localStorage.setItem(
            KEY,
            JSON.stringify([{ role: 'assistant', content: '', movies: [movie()] }]),
        );
        const loaded = loadTranscript();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].movies).toHaveLength(1);
    });
});
