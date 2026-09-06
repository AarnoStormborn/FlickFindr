/**
 * Local-first movie lists (no accounts). Data shape is versioned so it can
 * move to a backend later without UI churn.
 *
 * Storage key: flickfindr-lists
 * Shape: { v: 1, lists: [{ id, name, createdAt, movies: [snapshot, ...] }] }
 * Snapshot: { id, title, poster, year, rating } — enough to render lists
 * instantly; opening a movie always fetches fresh detail.
 */

const LISTS_KEY = 'flickfindr-lists';
const DEFAULT_LIST_NAME = 'Watch later';
export const WATCH_LATER_ID = 'watch-later';

function uid() {
    return `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyListsData() {
    return {
        v: 1,
        lists: [
            {
                id: WATCH_LATER_ID,
                name: DEFAULT_LIST_NAME,
                createdAt: Date.now(),
                movies: [],
            },
        ],
    };
}

export function loadLists() {
    try {
        const raw = localStorage.getItem(LISTS_KEY);
        if (!raw) return emptyListsData();
        const data = JSON.parse(raw);
        if (!data || data.v !== 1 || !Array.isArray(data.lists)) return emptyListsData();
        // ensure the default list always exists
        if (!data.lists.some((l) => l.id === WATCH_LATER_ID)) {
            data.lists.unshift({ id: WATCH_LATER_ID, name: DEFAULT_LIST_NAME, createdAt: Date.now(), movies: [] });
        }
        return data;
    } catch {
        return emptyListsData();
    }
}

function persist(data) {
    try {
        localStorage.setItem(LISTS_KEY, JSON.stringify(data));
    } catch {
        /* storage full/unavailable — ignore */
    }
    return data;
}

export function movieSnapshot(movie) {
    return {
        id: movie.id,
        title: movie.movie_name || movie.title || `Movie ${movie.id}`,
        poster: movie.poster_url || null,
        year: movie.release_year ?? null,
        rating: movie.rating ?? null,
        addedAt: Date.now(),
    };
}

/** Add a movie to a list; no-op if already present. Returns updated data. */
export function addToList(data, listId, snapshot) {
    const lists = data.lists.map((l) => {
        if (l.id !== listId) return l;
        if (l.movies.some((m) => m.id === snapshot.id)) return l; // already saved
        return { ...l, movies: [snapshot, ...l.movies] };
    });
    return persist({ ...data, lists });
}

/** Remove a movie from a list. Returns updated data. */
export function removeFromList(data, listId, movieId) {
    const lists = data.lists.map((l) =>
        l.id === listId ? { ...l, movies: l.movies.filter((m) => m.id !== movieId) } : l,
    );
    return persist({ ...data, lists });
}

export function movieInAnyList(data, movieId) {
    return data.lists.some((l) => l.movies.some((m) => m.id === movieId));
}

export function createList(data, name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return data;
    const exists = data.lists.some((l) => l.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) return data;
    const list = { id: uid(), name: trimmed, createdAt: Date.now(), movies: [] };
    return persist({ ...data, lists: [...data.lists, list] });
}

export function renameList(data, listId, name) {
    const trimmed = (name || '').trim();
    if (!trimmed || listId === WATCH_LATER_ID) return data; // default is fixed-name
    const lists = data.lists.map((l) => (l.id === listId ? { ...l, name: trimmed } : l));
    return persist({ ...data, lists });
}

export function deleteList(data, listId) {
    if (listId === WATCH_LATER_ID) return data; // never delete the default
    return persist({ ...data, lists: data.lists.filter((l) => l.id !== listId) });
}
