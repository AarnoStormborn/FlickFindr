import { useCallback, useState } from 'react';

/**
 * Local-first concierge transcript.
 *
 * Without this, navigating away from /chat and back (or reloading) threw the
 * conversation away, which made the page feel disposable — you could not ask a
 * follow-up after clicking into a movie and coming back.
 *
 * Stored the same way as the other local state in this app (search history,
 * lists, view mode): a `flickfindr-*` key, JSON, validated on read, capped so
 * it cannot grow without bound, and every storage call wrapped so a full or
 * unavailable store degrades to "no history" instead of breaking the page.
 */

const TRANSCRIPT_KEY = 'flickfindr-concierge-transcript';

/** Messages kept, not turns — one turn is a user message plus a reply. */
const MAX_MESSAGES = 40;

function isMovie(m) {
    return m && typeof m === 'object' && typeof m.id === 'number' && typeof m.movie_name === 'string';
}

/** Keep only the fields a card renders, so the stored payload stays small. */
function normalizeMovie(m) {
    return {
        id: m.id,
        movie_name: m.movie_name,
        release_year: typeof m.release_year === 'number' ? m.release_year : null,
        rating: typeof m.rating === 'number' ? m.rating : null,
        runtime: typeof m.runtime === 'number' ? m.runtime : null,
        genre: typeof m.genre === 'string' ? m.genre : null,
        poster_url: typeof m.poster_url === 'string' ? m.poster_url : null,
    };
}

function isMessage(m) {
    return m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
}

export function loadTranscript() {
    try {
        const raw = localStorage.getItem(TRANSCRIPT_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const messages = parsed.filter(isMessage).map((m) => ({
            role: m.role,
            content: m.content,
            movies: Array.isArray(m.movies) ? m.movies.filter(isMovie).map(normalizeMovie) : [],
        }));
        // A turn interrupted mid-stream (navigated away, request aborted) can
        // leave a trailing empty assistant placeholder — don't restore that.
        while (messages.length) {
            const last = messages[messages.length - 1];
            if (last.role === 'assistant' && !last.content && !last.movies.length) messages.pop();
            else break;
        }
        return messages;
    } catch {
        return [];
    }
}

function saveTranscript(messages) {
    try {
        localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(messages));
    } catch {
        /* storage full / unavailable — ignore */
    }
}

/**
 * Transcript state that survives navigation and reloads.
 * `update` accepts a value or an updater function, like a setState.
 */
export default function useChatTranscript() {
    const [messages, setMessages] = useState(loadTranscript);

    const update = useCallback((updater) => {
        setMessages((prev) => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            const trimmed = next.slice(-MAX_MESSAGES);
            saveTranscript(trimmed);
            return trimmed;
        });
    }, []);

    const clear = useCallback(() => {
        saveTranscript([]);
        setMessages([]);
    }, []);

    return { messages, update, clear };
}
